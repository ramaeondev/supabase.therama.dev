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

    const user_id = user.id;
    const name = 'Root';
    const s3_key_prefix = `${user_id}/${name}/`;
    const path = `${user_id}/${name}`;

    // Check if root folder already exists
    const { data: existing, error: checkError } = await supabase
      .from('folders')
      .select('id')
      .eq('user_id', user_id)
      .eq('is_root', true)
      .single();

    if (existing) {
      return addCorsHeaders(new Response(JSON.stringify({ message: 'Root folder already exists' }), { status: 200 }));
    }

    // Create root folder in S3
    await s3.send(new PutObjectCommand({
      Bucket: Deno.env.get('S3_BUCKET_Cloudnotes_Bucket')!,
      Key: s3_key_prefix,
      Body: '',
    }));

    // Insert root folder metadata
    const { error: insertError } = await supabase.from('folders').insert([
      {
        name,
        user_id,
        parent_folder_id: null,
        s3_key_prefix,
        path,
        is_system: true,
        is_root: true,
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
