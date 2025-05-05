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
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Invalid user session' }), { status: 401 }));
    }

    const { s3Key } = await req.json();

    if (!s3Key) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Missing S3 key' }), { status: 400 }));
    }

    // Create the GetObjectCommand to get the object from S3
    const command = new GetObjectCommand({
      Bucket: Deno.env.get('S3_BUCKET_Cloudnotes_Bucket')!,
      Key: s3Key,
      ResponseContentDisposition: "attachment",
    });

    // Generate a pre-signed URL for accessing the S3 object
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // Expires in 1 hour

    return addCorsHeaders(
      new Response(JSON.stringify({ url: signedUrl }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    ));
  } catch (err) {
    console.error("Signed URL error:", err);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500 })
    );
  }
});
