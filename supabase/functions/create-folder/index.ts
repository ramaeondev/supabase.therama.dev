import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js';
import { S3Client, PutObjectCommand } from 'npm:@aws-sdk/client-s3';
import { addCorsHeaders, handleCors } from "../shared/cors.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const s3 = new S3Client({
  region: Deno.env.get('AWS_REGION_Clounotes_Bucket')!,
  credentials: {
    accessKeyId: Deno.env.get('S3_WRITE_ACCESS_KEY_ID_Clounotes_Bucket')!,
    secretAccessKey: Deno.env.get('S3_WRITE_SECRET_ACCESS_KEY_Clounotes_Bucket')!,
  },
});

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

    const { name, user_id, parent_folder_id } = await req.json();

    // Ensure user can only create folders for themselves
    if (user.id !== user_id) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Forbidden: Cannot act on another user\'s folders' }), { status: 403 }));
    }

    if (!parent_folder_id) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Cannot create folder at root level' }), { status: 400 }));
    }

    // Fetch parent folder to build path and S3 prefix
    const { data: parent, error: parentError } = await supabase
      .from('folders')
      .select('s3_key_prefix, path')
      .eq('id', parent_folder_id)
      .single();

    if (parentError || !parent) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Invalid parent_folder_id' }), { status: 400 }));
    }

    const s3_key_prefix = `${parent.s3_key_prefix}${name}/`;
    const path = `${parent.path}/${name}`;

    // Create folder in S3
    await s3.send(new PutObjectCommand({
      Bucket: Deno.env.get('S3_BUCKET_Cloudnotes_Bucket')!,
      Key: s3_key_prefix,
      Body: '',
    }));

    // Insert into Supabase DB
    const { error: insertError } = await supabase.from('folders').insert([
      {
        name,
        user_id,
        parent_folder_id,
        s3_key_prefix,
        path,
      },
    ]);

    if (insertError) {
      return addCorsHeaders(new Response(JSON.stringify({ error: insertError.message }), { status: 500 }));
    }

    return addCorsHeaders(new Response(JSON.stringify({ success: true }), { status: 200 }));
  } catch (err) {
    console.error(err);
    return addCorsHeaders(new Response(JSON.stringify({ error: 'Unexpected server error' }), { status: 500 }));
  }
});
