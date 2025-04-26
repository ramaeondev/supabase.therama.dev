// Supabase Edge Function: get-s3-billing-logs
// Purpose: Retrieve all S3 billing metrics logs from the database

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { handleCors, addCorsHeaders } from "../shared/cors.ts";

function getSupabaseClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

serve(async (req) => {
  // Handle CORS preflight
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = getSupabaseClient();
  // Support ?bucket_name=...&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
  const url = new URL(req.url);
  const bucketName = url.searchParams.get("bucket_name");
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");

  let query = supabase.from("s3_billing_metrics_with_project").select("*");
  // If any filter provided, use them
  if (bucketName) {
    query = query.eq("bucket", bucketName);
  }
  if (startDate && endDate) {
    query = query.gte("collected_at", `${startDate}T00:00:00Z`).lt("collected_at", `${endDate}T23:59:59.999Z`);
  } else if (startDate) {
    query = query.gte("collected_at", `${startDate}T00:00:00Z`);
  } else if (endDate) {
    query = query.lte("collected_at", `${endDate}T23:59:59.999Z`);
  }
  // If no filters, default to current month
  if (!bucketName && !startDate && !endDate) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    query = query.gte("collected_at", monthStart.toISOString()).lt("collected_at", nextMonth.toISOString());
  }
  query = query.order("collected_at", { ascending: true });

  const { data, error } = await query;
  if (error) {
    return addCorsHeaders(new Response(JSON.stringify({ error }), { status: 500 }));
  }
  return addCorsHeaders(new Response(JSON.stringify({ logs: data }), {
    headers: { "Content-Type": "application/json" },
  }));
});


// All logs for the current month (default):

// CopyInsert
// GET https://<your-project>.functions.supabase.co/get-s3-billing-logs
// 2. Logs for a specific bucket:

// CopyInsert
// GET https://<your-project>.functions.supabase.co/get-s3-billing-logs?bucket_name=my-bucket
// 3. Logs for a date range:

// CopyInsert
// GET https://<your-project>.functions.supabase.co/get-s3-billing-logs?start_date=2025-04-01&end_date=2025-04-20
// 4. Logs for a bucket and date range:

// CopyInsert
// GET https://<your-project>.functions.supabase.co/get-s3-billing-logs?bucket_name=my-bucket&start_date=2025-04-01&end_date=2025-04-20
// 5. Logs from a start date onward:

// CopyInsert
// GET https://<your-project>.functions.supabase.co/get-s3-billing-logs?start_date=2025-04-10
// 6. Logs up to an end date:

// CopyInsert
// GET https://<your-project>.functions.supabase.co/get-s3-billing-logs?end_date=2025-04-15
