import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";
import { addCorsHeaders, corsHeaders } from "../shared/cors.ts";

async function uploadToS3(
  key: string,
  body: string | Uint8Array,
  contentType = "application/json"
): Promise<{ success: boolean; error?: unknown }> {
  // Validate required environment variables
  const region = Deno.env.get("AWS_REGION_GITHUB_WEBHOOK");
  const accessKeyId = Deno.env.get("S3_WRITE_ACCESS_ATTACHMENTS_BUCKET_KEY_ID");
  const secretAccessKey = Deno.env.get("S3_WRITE_ACCESS_ATTACHMENTS_BUCKET_KEY");
  const bucket = Deno.env.get("S3_BUCKET_NAME_GITHUB_WEBHOOK");

  if (!region || !accessKeyId || !secretAccessKey || !bucket) {
    console.error("Missing required AWS environment variables");
    return { success: false, error: "Missing AWS configuration" };
  }

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return { success: true };
  } catch (err) {
    console.error("S3 Upload Error:", err);
    return { success: false, error: err };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const event = req.headers.get("x-github-event");
    if (event !== "workflow_run") {
      return addCorsHeaders(
        new Response(
          JSON.stringify({ message: "Ignored event" }), 
          { 
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      );
    }

    const payload = await req.json();
    const run = payload?.workflow_run;

    if (!run || !payload.repository) {
      return addCorsHeaders(
        new Response(
          JSON.stringify({ error: "Invalid webhook payload" }),
          { 
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        )
      );
    }

    const data = {
      repo: payload.repository.full_name,
      workflow: run.name,
      run_id: run.id,
      conclusion: run.conclusion,
      status: run.status,
      branch: run.head_branch,
      commit: run.head_sha,
      timestamp: new Date().toISOString(),
    };

    const s3Path = `github-logs/${data.repo}/${data.run_id}.json`;
    const { success, error } = await uploadToS3(s3Path, JSON.stringify(data));

    if (!success) {
      return addCorsHeaders(
        new Response(
          JSON.stringify({ error: "Failed to store log in S3", details: error }),
          { 
            status: 500,
            headers: { "Content-Type": "application/json" }
          }
        )
      );
    }

    return addCorsHeaders(
      new Response(
        JSON.stringify({ message: "Log stored in S3" }),
        { 
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return addCorsHeaders(
      new Response(
        JSON.stringify({ error: "Internal server error" }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
  }
});
