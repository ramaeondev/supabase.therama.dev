import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { S3Client, ListObjectsV2Command } from "npm:@aws-sdk/client-s3";
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
  // Handle CORS
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

    const { folder_path } = await req.json();
    if (!folder_path) {
      return addCorsHeaders(new Response(JSON.stringify({ error: "Missing folder_path" }), { status: 400 }));
    }

    const command = new ListObjectsV2Command({
      Bucket: Deno.env.get("S3_BUCKET_Cloudnotes_Bucket")!,
      Prefix: folder_path,
    });

    const result = await s3.send(command);
    const files = (result.Contents ?? []).filter(obj =>
      obj.Key !== folder_path && obj.Size !== 0
    );    

    const totalSize = files.reduce((sum, obj) => sum + (obj.Size ?? 0), 0);
    const fileCount = files.length;
    const lastModified = files.reduce((latest, obj) => {
      const objDate = obj.LastModified ? new Date(obj.LastModified) : null;
      if (!latest) return objDate;
      if (objDate && objDate > latest) return objDate;
      return latest;
    }, null as Date | null);

    return addCorsHeaders(
      new Response(JSON.stringify({
        folder_path,
        fileCount,
        totalSize,
        lastModified,
      }), { status: 200 })
    );
  } catch (err) {
    console.error("Error in get-folder-properties:", err);
    return addCorsHeaders(new Response(JSON.stringify({ error: "Server error" }), { status: 500 }));
  }
});
