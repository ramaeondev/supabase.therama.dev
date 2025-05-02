import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "npm:@aws-sdk/client-s3";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { addCorsHeaders, handleCors } from "../shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const s3 = new S3Client({
  region: Deno.env.get("AWS_REGION_Clounotes_Bucket")!,
  credentials: {
    accessKeyId: Deno.env.get("S3_WRITE_ACCESS_KEY_ID_Clounotes_Bucket")!,
    secretAccessKey: Deno.env.get("S3_WRITE_SECRET_ACCESS_KEY_Clounotes_Bucket")!,
  },
});

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return addCorsHeaders(new Response(JSON.stringify({ error: "Missing or invalid token" }), { status: 401 }));
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return addCorsHeaders(new Response(JSON.stringify({ error: "Invalid user session" }), { status: 401 }));
    }

    const { old_path, new_path, is_folder, folder_id } = await req.json();
    if (!old_path || !new_path) {
      return addCorsHeaders(new Response(JSON.stringify({ error: "Missing old_path or new_path" }), { status: 400 }));
    }

    // For folders, we need to update the database record too
    if (is_folder && folder_id) {
      // Extract the new folder name from the path
      const oldPathParts = old_path.split("/");
      const newPathParts = new_path.split("/");
      const newFolderName = newPathParts[newPathParts.length - 2]; // Account for trailing slash
      
      // Update folder in database
      const { error: updateError } = await supabase
        .from("folders")
        .update({ 
          name: newFolderName, 
          s3_key_prefix: new_path,
          // Update path by replacing the last segment with the new name
          path: updateFolderPath(
            await getFolderPath(folder_id),
            oldPathParts[oldPathParts.length - 2], // Old name
            newFolderName // New name
          )
        })
        .eq("id", folder_id);
      
      if (updateError) {
        return addCorsHeaders(new Response(JSON.stringify({ 
          error: "Failed to update database record", 
          details: updateError.message 
        }), { status: 500 }));
      }
      
      // Update all child folders with the new path prefix
      await updateChildFolderPaths(folder_id, old_path, new_path);
    }

    const Bucket = Deno.env.get("S3_BUCKET_Cloudnotes_Bucket")!;
    
    // Use paths exactly as provided from the UI
    const oldPathNormalized = old_path;
    const newPathNormalized = new_path;
    
    console.log(`Processing paths: old=${oldPathNormalized}, new=${newPathNormalized}, is_folder=${is_folder}`);

    if (is_folder) {
      // For folders, we need to list all objects and move them individually
      const listCmd = new ListObjectsV2Command({
        Bucket,
        Prefix: oldPathNormalized,
      });

      let objects = [];
      try {
        const listResult = await s3.send(listCmd);
        objects = listResult.Contents ?? [];
        console.log(`Found ${objects.length} objects:`, objects.map(o => o.Key));
        
        // Debug: Log the full list response to inspect other fields
        console.log("List response:", JSON.stringify({
          CommonPrefixes: listResult.CommonPrefixes,
          IsTruncated: listResult.IsTruncated,
          KeyCount: listResult.KeyCount,
          MaxKeys: listResult.MaxKeys,
          NextContinuationToken: listResult.NextContinuationToken,
          Prefix: listResult.Prefix
        }));
      } catch (listError) {
        console.error("Error listing objects:", listError);
        return addCorsHeaders(new Response(JSON.stringify({ 
          error: "Failed to list objects", 
          details: listError.message,
          prefix: oldPathNormalized
        }), { status: 500 }));
      }

      // If folder is empty (just has the folder marker) or doesn't exist
      if (objects.length === 0) {
        console.log(`No objects found under folder: ${oldPathNormalized}`);
        
        // Try creating an empty folder marker at the destination anyway
        try {
          console.log("Creating empty marker object at destination");
          // There are two common ways to handle empty folders in S3
          
          // Method 1: Try to use CopyObject to copy a potentially existing empty folder marker
          try {
            await s3.send(new CopyObjectCommand({
              Bucket,
              CopySource: `/${Bucket}/${oldPathNormalized}`,
              Key: newPathNormalized,
            }));
            console.log("Successfully copied folder marker");
          } catch (markerErr) {
            console.log("Couldn't copy folder marker, trying to create one", markerErr);
            
            // Method 2: Create a new empty object as a folder marker
            // This requires the PutObject permission which might not be included in the current implementation
            // If needed, you would need to import and use PutObjectCommand from AWS SDK
          }
          
          return addCorsHeaders(new Response(JSON.stringify({ 
            message: "Folder appears to be empty, created destination marker", 
            warning: "Original empty folder may still exist"
          }), { status: 200 }));
        } catch (e) {
          console.error("Failed to handle empty folder:", e);
        }
        
        return addCorsHeaders(new Response(JSON.stringify({ 
          error: "Folder not found or is empty", 
          prefix: oldPathNormalized 
        }), { status: 404 }));
      }

      // Create an array to track operations
      const operations = [];

      for (const obj of objects) {
        const srcKey = obj.Key!;
        // Replace just the folder prefix part while maintaining subfolder structure
        const destKey = srcKey.replace(oldPathNormalized, newPathNormalized);

        console.log(`Copying ${srcKey} → ${destKey}`);

        try {
          // Add both operations to our tracking array
          operations.push(
            s3.send(new CopyObjectCommand({
              Bucket,
              CopySource: `/${Bucket}/${srcKey}`,
              Key: destKey,
            }))
          );
        } catch (copyErr) {
          console.error(`Failed to copy ${srcKey} → ${destKey}`, copyErr);
          return addCorsHeaders(new Response(JSON.stringify({ error: `Failed to rename ${srcKey}` }), { status: 500 }));
        }
      }

      // Wait for all copy operations to complete
      try {
        await Promise.all(operations);
        console.log("All copy operations completed successfully");
      } catch (batchCopyError) {
        console.error("Error during batch copy operations:", batchCopyError);
        return addCorsHeaders(new Response(JSON.stringify({ 
          error: "Failed during copy operations", 
          details: batchCopyError.message 
        }), { status: 500 }));
      }
      
      // Now delete the original objects
      const deleteOperations = [];
      for (const obj of objects) {
        deleteOperations.push(
          s3.send(new DeleteObjectCommand({
            Bucket,
            Key: obj.Key!,
          }))
        );
      }
      
      // Wait for all delete operations to complete
      try {
        await Promise.all(deleteOperations);
        console.log("All delete operations completed successfully");
      } catch (batchDeleteError) {
        console.error("Error during batch delete operations:", batchDeleteError);
        return addCorsHeaders(new Response(JSON.stringify({ 
          error: "Files were copied but failed to delete originals", 
          details: batchDeleteError.message,
          warning: "This has resulted in duplicate files"
        }), { status: 500 }));
      }
    } else {
      // Single file rename
      console.log(`Renaming file ${oldPathNormalized} → ${newPathNormalized}`);
      try {
        await s3.send(new CopyObjectCommand({
          Bucket,
          CopySource: `/${Bucket}/${oldPathNormalized}`,
          Key: newPathNormalized,
        }));
        await s3.send(new DeleteObjectCommand({
          Bucket,
          Key: oldPathNormalized,
        }));
      } catch (copyErr) {
        console.error(`Failed to rename file`, copyErr);
        return addCorsHeaders(new Response(JSON.stringify({ error: "Rename failed" }), { status: 500 }));
      }
    }

    return addCorsHeaders(new Response(JSON.stringify({ 
      message: "Rename successful",
      from: oldPathNormalized,
      to: newPathNormalized,
      is_folder: is_folder
    }), { status: 200 }));
  } catch (err) {
    console.error("Unexpected server error:", err);
    return addCorsHeaders(new Response(JSON.stringify({ error: "Server error", details: err.message }), { status: 500 }));
  }
});

// Helper function to get a folder's path from the database
async function getFolderPath(folderId: string): Promise<string> {
  const { data, error } = await supabase
    .from("folders")
    .select("path")
    .eq("id", folderId)
    .single();
  
  if (error || !data) {
    throw new Error(`Failed to get folder path: ${error?.message || "Not found"}`);
  }
  
  return data.path;
}

// Helper function to update the path string with a new folder name
function updateFolderPath(fullPath: string, oldName: string, newName: string): string {
  // Replace the last occurrence of oldName with newName
  const pathParts = fullPath.split("/");
  for (let i = pathParts.length - 1; i >= 0; i--) {
    if (pathParts[i] === oldName) {
      pathParts[i] = newName;
      break;
    }
  }
  return pathParts.join("/");
}

// Helper function to update all child folder paths when a parent folder is renamed
async function updateChildFolderPaths(parentFolderId: string, oldPrefix: string, newPrefix: string) {
  // First get all direct child folders
  const { data: childFolders, error } = await supabase
    .from("folders")
    .select("id, s3_key_prefix, path")
    .eq("parent_folder_id", parentFolderId);
  
  if (error || !childFolders) {
    console.error("Error getting child folders:", error);
    return;
  }
  
  // Update each child folder
  for (const folder of childFolders) {
    // Update the S3 key prefix
    const newS3KeyPrefix = folder.s3_key_prefix.replace(oldPrefix, newPrefix);
    
    // Update the path by replacing the part that contains the old path
    const oldPathParts = oldPrefix.split("/");
    const newPathParts = newPrefix.split("/");
    const oldName = oldPathParts[oldPathParts.length - 2]; // Account for trailing slash
    const newName = newPathParts[newPathParts.length - 2]; // Account for trailing slash
    const newPath = updateFolderPath(folder.path, oldName, newName);
    
    // Update this folder
    const { error: updateError } = await supabase
      .from("folders")
      .update({ 
        s3_key_prefix: newS3KeyPrefix,
        path: newPath
      })
      .eq("id", folder.id);
    
    if (updateError) {
      console.error(`Failed to update child folder ${folder.id}:`, updateError);
    }
    
    // Recursively update this folder's children
    await updateChildFolderPaths(folder.id, folder.s3_key_prefix, newS3KeyPrefix);
  }
}