import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js';
import { addCorsHeaders, handleCors } from "../shared/cors.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Only allow GET method for fetching data
  if (req.method !== 'GET') {
    return addCorsHeaders(new Response('Method Not Allowed', { status: 405 }));
  }

  try {
    // Extract JWT token from Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Fetch user data using the JWT token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 }));
    }

    // Fetch folders and files for the authenticated user
    const { data: folders, error: folderError } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', user.id); // Fetch folders specific to the user

    if (folderError) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Error fetching folders' }), { status: 500 }));
    }

    const { data: files, error: fileError } = await supabase
      .from('files')
      .select('*')
      .eq('user_id', user.id); // Fetch files specific to the user

    if (fileError) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Error fetching files' }), { status: 500 }));
    }

    // Combine folders and files into a response object
    const responseData = { folders, files };

    return addCorsHeaders(new Response(JSON.stringify(responseData), { status: 200 }));
  } catch (err) {
    console.error(err);
    return addCorsHeaders(new Response(JSON.stringify({ error: 'Server error' }), { status: 500 }));
  }
});
