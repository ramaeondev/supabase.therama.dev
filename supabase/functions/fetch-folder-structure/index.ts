import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js';
import { addCorsHeaders, handleCors } from "../shared/cors.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

interface Folder {
    id: string;
    name: string;
    parent_folder_id: string | null;
    path: string;
    children: Folder[]; // Array of Folder objects (subfolders)
  }
  
serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Missing or invalid token' }), { status: 401 }));
    }

    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Invalid user session' }), { status: 401 }));
    }

    const user_id = user.id;

    // Fetch the folder structure for the logged-in user
    const { data: folders, error: fetchError } = await supabase
      .from('folders')
      .select('id, name, parent_folder_id, path')
      .eq('user_id', user_id)
      .order('path', { ascending: true });

    if (fetchError) {
      return addCorsHeaders(new Response(JSON.stringify({ error: fetchError.message }), { status: 500 }));
    }

    // Build a hierarchical folder structure
    const folderTree = buildFolderTree(folders);

    return addCorsHeaders(new Response(JSON.stringify({ folderTree }), { status: 200 }));

  } catch (err) {
    console.error(err);
    return addCorsHeaders(new Response(JSON.stringify({ error: 'Unexpected server error' }), { status: 500 }));
  }
});

// Function to build folder hierarchy
function buildFolderTree(folders: Folder[]): Folder[] {
    const folderMap: { [key: string]: Folder } = {};
  
    // Create a map of folders
    folders.forEach((folder) => {
      folderMap[folder.id] = { ...folder, children: [] };
    });
  
    const rootFolders: Folder[] = [];
  
    // Build the hierarchy
    folders.forEach((folder) => {
      if (folder.parent_folder_id === null) {
        rootFolders.push(folderMap[folder.id]);
      } else {
        const parentFolder = folderMap[folder.parent_folder_id];
        if (parentFolder) {
          parentFolder.children.push(folderMap[folder.id]);
        }
      }
    });
  
    return rootFolders;
  }