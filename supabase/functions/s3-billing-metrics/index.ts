// Supabase Edge Function: s3-billing-metrics
// Purpose: Fetch all AWS S3 metrics that impact billing from all buckets in all regions, store in Supabase table
// Running via pg_cron + pg_net; remove export schedule
// export const schedule = '0 12 * * *';

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { S3Client, ListBucketsCommand, GetBucketLocationCommand } from "npm:@aws-sdk/client-s3";
import { CloudWatchClient, GetMetricStatisticsCommand } from "npm:@aws-sdk/client-cloudwatch";

// Helper to get AWS credentials from Supabase secrets
async function getAWSCredentials() {
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID_METRICS");
  const secretAccessKey = Deno.env.get("AWS_ACCESS_KEY_METRICS");
  if (!accessKeyId || !secretAccessKey) {
    console.error("[getAWSCredentials] Missing AWS creds:", { accessKeyId, secretAccessKey });
    throw new Error("AWS credentials not configured");
  }
  return { accessKeyId, secretAccessKey };
}

// Helper to get Supabase client
function getSupabaseClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// Helper: Get all S3 buckets and their regions
async function getAllBucketsAndRegions(s3: S3Client) {
  console.log("[getAllBucketsAndRegions] Listing all S3 buckets...");
  const bucketsResp = await s3.send(new ListBucketsCommand({}));
  console.log(`[getAllBucketsAndRegions] Buckets response: ${JSON.stringify(bucketsResp.Buckets)}`);
  const buckets = bucketsResp.Buckets || [];
  const result: { name: string; region: string }[] = [];
  for (const bucket of buckets) {
    console.log(`[getAllBucketsAndRegions] Processing bucket: ${bucket.Name}`);
    try {
      const locResp = await s3.send(
        new GetBucketLocationCommand({ Bucket: bucket.Name! })
      );
      let region = locResp.LocationConstraint || "us-east-1";
      if (region === "") region = "us-east-1";
      console.log(`[getAllBucketsAndRegions] Bucket: ${bucket.Name}, Region: ${region}`);
      result.push({ name: bucket.Name!, region });
    } catch (e) {
      console.warn(`[getAllBucketsAndRegions] Failed to get region for bucket ${bucket.Name}: ${e}`);
      // Skip buckets we can't access
      continue;
    }
  }
  console.log(`[getAllBucketsAndRegions] Finished. Total accessible buckets: ${result.length}`);
  return result;
}


// Helper: Get billing-impacting metrics for a bucket/region
async function getBucketMetrics(bucket: string, _region: string, creds: any) {
  // S3 metrics are published globally in us-east-1
  const cw = new CloudWatchClient({ region: "us-east-1", credentials: creds });
  const now = new Date();
  const start = new Date(now.getTime() - 48 * 60 * 60 * 1000); // last 48h to capture daily metrics
  // Metrics to pull
  const metrics = [
    {
      name: "BucketSizeBytes",
      dbKey: "bucketsizebytes",
      stat: "Average",
      dimensions: [
        { Name: "BucketName", Value: bucket },
        { Name: "StorageType", Value: "StandardStorage" },
      ],
      namespace: "AWS/S3",
    },
    {
      name: "NumberOfObjects",
      dbKey: "numberofobjects",
      stat: "Average",
      dimensions: [
        { Name: "BucketName", Value: bucket },
        { Name: "StorageType", Value: "AllStorageTypes" },
      ],
      namespace: "AWS/S3",
    },
    {
      name: "AllRequests",
      dbKey: "allrequests",
      stat: "Sum",
      dimensions: [
        { Name: "BucketName", Value: bucket },
        { Name: "FilterId", Value: "EntireBucket" },
      ],
      namespace: "AWS/S3",
    },
    {
      name: "BytesDownloaded",
      dbKey: "bytesdownloaded",
      stat: "Sum",
      dimensions: [
        { Name: "BucketName", Value: bucket },
        { Name: "FilterId", Value: "EntireBucket" },
      ],
      namespace: "AWS/S3",
    },
    {
      name: "BytesUploaded",
      dbKey: "bytesuploaded",
      stat: "Sum",
      dimensions: [
        { Name: "BucketName", Value: bucket },
        { Name: "FilterId", Value: "EntireBucket" },
      ],
      namespace: "AWS/S3",
    },
  ];
  const results: Record<string, number | null> = {};
  for (const metric of metrics) {
    console.log(`[getBucketMetrics] Requesting ${metric.name} for ${bucket}`);
    try {
      const resp = await cw.send(
        new GetMetricStatisticsCommand({
          Namespace: metric.namespace,
          MetricName: metric.name,
          Dimensions: metric.dimensions,
          StartTime: start,
          EndTime: now,
          Period: 86400,
          Statistics: [metric.stat],
        })
      );
      console.log(`[getBucketMetrics] ${metric.name} datapoints for ${bucket}: ${JSON.stringify(resp.Datapoints)}`);
      const dps = resp.Datapoints ?? [];
      dps.sort((a, b) => b.Timestamp!.getTime() - a.Timestamp!.getTime());
      const value = dps[0]?.[metric.stat] ?? null;
      console.log(`[getBucketMetrics] ${metric.name} value for ${bucket}: ${value}`);
      // default to 0 when no datapoint
      results[metric.dbKey] = value ?? 0;
    } catch (e) {
      console.error(`[getBucketMetrics] Error fetching ${metric.name}:`, e);
      // on error, record zero
      results[metric.dbKey] = 0;
    }
  }
  return results;
}

serve(async (_req) => {
  const creds = await getAWSCredentials();
  const s3 = new S3Client({ region: "us-east-1", credentials: creds });
  const supabase = getSupabaseClient();
  const buckets = await getAllBucketsAndRegions(s3);
  const data = [];
  for (const { name, region } of buckets) {
    console.log(`[metrics] Fetching metrics for bucket: ${name}, region: ${region}`);
    const metrics = await getBucketMetrics(name, region, creds);
    data.push({
      bucket: name,
      region,
      ...metrics,
      collected_at: new Date().toISOString(),
    });
  }
  // Insert into Supabase table
  const { error } = await supabase.from("s3_billing_metrics").insert(data);
  if (error) {
    console.error("[insert] Error inserting metrics:", error);
    return new Response(JSON.stringify({ error }), { status: 500 });
  }
  return new Response(JSON.stringify({ success: true, count: data.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
