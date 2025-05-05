/// Not wokring as expected
/// <reference lib="deno.unstable" />
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js';
import { S3Client, GetObjectCommand } from 'npm:@aws-sdk/client-s3';
import { addCorsHeaders, handleCors } from "../shared/cors.ts"; // Import CORS functions

// Initialize Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Initialize AWS S3 client
const s3 = new S3Client({
  region: Deno.env.get('AWS_REGION_Clounotes_Bucket')!,
  credentials: {
    accessKeyId: Deno.env.get('S3_WRITE_ACCESS_KEY_ID_Clounotes_Bucket')!,
    secretAccessKey: Deno.env.get('S3_WRITE_SECRET_ACCESS_KEY_Clounotes_Bucket')!,
  },
});

// Main server function
serve(async (req) => {
  // Handle CORS preflight request
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse; // If it's a preflight, return CORS headers

  try {
    // Check for Authorization header and extract token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Missing or invalid token' }), { status: 401 }));
    }

    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    // Check if the user is authenticated
    if (authError || !user) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Invalid user session' }), { status: 401 }));
    }
    
    // Get query parameters (s3_key and download flag)
    const urlParams = new URL(req.url).searchParams;
    const s3_key = urlParams.get('s3_key');
    const download = urlParams.get('download') === 'true';

    if (!s3_key) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Missing s3_key parameter' }), { status: 400 }));
    }

    // Check if the file exists in S3 (retrieve file metadata)
    const { error: fileError } = await s3.send(new GetObjectCommand({
      Bucket: Deno.env.get('S3_BUCKET_Cloudnotes_Bucket')!,
      Key: s3_key,
    }));

    if (fileError) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'File not found in S3' }), { status: 404 }));
    }

    // Fetch the file from S3
    const fileCommand = new GetObjectCommand({
      Bucket: Deno.env.get('S3_BUCKET_Cloudnotes_Bucket')!,
      Key: s3_key,
    });

    const file = await s3.send(fileCommand);

    // If download is true, force the file download
    if (download) {
      const fileStream = file.Body as ReadableStream;
      const response = new Response(fileStream, { headers: { 
        'Content-Disposition': `attachment; filename="${s3_key.split('/').pop()}"`,
        'Content-Type': 'application/octet-stream'
      }});

      return addCorsHeaders(response);
    }

    // If download is false, serve the file for preview (e.g., an image preview)
    const fileStream = file.Body as ReadableStream;
    const response = new Response(fileStream, { headers: { 
      'Content-Type': file.ContentType || 'application/octet-stream',
    }});

    return addCorsHeaders(response);

  } catch (err) {
    console.error(err);
    return addCorsHeaders(new Response(JSON.stringify({ error: 'Unexpected server error' }), { status: 500 }));
  }
});
