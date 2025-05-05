import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js';
import { S3Client, GetObjectCommand } from 'npm:@aws-sdk/client-s3';
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3.305.0";
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
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Invalid user session' }), { status: 401 }));
    }

    const { s3Key } = await req.json();

    if (!s3Key) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Missing S3 key' }), { status: 400 }));
    }

    // Get file extension
    const fileExtension = s3Key.split('.').pop()?.toLowerCase() || '';
    
    // Query content type from Supabase
    const { data: contentTypeData, error: contentTypeError } = await supabase
      .from('content_types')
      .select('mime_type')
      .eq('extension', fileExtension)
      .single();

    const contentType = contentTypeData?.mime_type || 'application/octet-stream';

    // Create the GetObjectCommand with appropriate content type
    const command = new GetObjectCommand({
      Bucket: Deno.env.get('S3_BUCKET_Cloudnotes_Bucket')!,
      Key: s3Key,
      ResponseContentType: contentType,
      ResponseContentDisposition: `inline; filename="${s3Key.split('/').pop()}"`
    });

    // Generate a pre-signed URL that expires in 1 hour
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return addCorsHeaders(
      new Response(JSON.stringify({ 
        url: signedUrl,
        contentType,
        filename: s3Key.split('/').pop()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
         }
      })
    );
  } catch (err) {
    console.error("Preview URL error:", err);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500 })
    );
  }
});