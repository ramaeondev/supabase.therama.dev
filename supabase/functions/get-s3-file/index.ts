import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { S3Client } from 'npm:@aws-sdk/client-s3';
import { handleCors, addCorsHeaders } from "../shared/cors.ts";


const region = Deno.env.get('AWS_REGION')!;
const bucket = Deno.env.get('S3_BUCKET_NAME')!;
const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID_READONLY')!;
const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY_READONLY')!;

const s3 = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json();
    const filename = body?.filename;

    if (!filename || typeof filename !== 'string') {
      throw new Error("Missing or invalid 'filename' in request body.");
    }

    // const url = `https://${bucket}.s3.${region}.amazonaws.com/${filename}`;
    const url = `https://s3.${region}.amazonaws.com/${bucket}/${filename}`;


    const response = new Response(
      JSON.stringify({ url }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    return addCorsHeaders(response);
  } catch (err) {
    const errorResponse = new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
    return addCorsHeaders(errorResponse);
  }
});


