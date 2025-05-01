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
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return addCorsHeaders(new Response('Method Not Allowed', { status: 405 }));
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 }));
    }

    const form = await req.formData();
    const file = form.get('file') as File | null;
    const folderId = form.get('folder_id')?.toString();
    const userId = form.get('user_id')?.toString();

    if (!file || !folderId || !userId) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Missing file, folder_id, or user_id' }), { status: 400 }));
    }

    // Optionally, check if file extension is in the supported list, but allow upload anyway
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    const { data: supportedExtensions, error: extensionsError } = await supabase
      .from('supported_file_extensions')
      .select('extension')
      .eq('extension', `.${fileExtension}`)
      .single();

    if (extensionsError) {
      console.warn('Error fetching supported extensions:', extensionsError.message);
    }

    // Optional: Log or notify user about unsupported file type (but still allow upload)
    if (!supportedExtensions) {
      console.warn('File extension not in supported list:', fileExtension);
      // Optionally notify the user that the file extension is not supported
    }

    // Get folder to construct path
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('s3_key_prefix')
      .eq('id', folderId)
      .eq('user_id', userId)
      .single();

    if (folderError || !folder) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Folder not found' }), { status: 404 }));
    }

    const s3Key = `${folder.s3_key_prefix}${file.name}`;

    await s3.send(new PutObjectCommand({
      Bucket: Deno.env.get('S3_BUCKET_Cloudnotes_Bucket')!,
      Key: s3Key,
      Body: file.stream(),
      ContentType: file.type,
    }));

    // Save file metadata to Supabase
    const { error: insertError } = await supabase.from('files').insert([{
      name: file.name,
      folder_id: folderId,
      user_id: userId,
      s3_key: s3Key,
      content_type: file.type,
      size: file.size,
    }]);

    if (insertError) {
      return addCorsHeaders(new Response(JSON.stringify({ error: insertError.message }), { status: 500 }));
    }

    return addCorsHeaders(new Response(JSON.stringify({ message: 'File uploaded successfully' }), { status: 200 }));
  } catch (err) {
    console.error(err);
    return addCorsHeaders(new Response(JSON.stringify({ error: 'Server error' }), { status: 500 }));
  }
});
