-- Create table to store S3 billing-impacting metrics per bucket/region per day
CREATE TABLE IF NOT EXISTS public.s3_billing_metrics (
    id BIGSERIAL PRIMARY KEY,
    bucket TEXT NOT NULL,
    region TEXT NOT NULL,
    BucketSizeBytes DOUBLE PRECISION,
    NumberOfObjects DOUBLE PRECISION,
    AllRequests DOUBLE PRECISION,
    BytesDownloaded DOUBLE PRECISION,
    BytesUploaded DOUBLE PRECISION,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Index for fast lookups by bucket and date
CREATE INDEX IF NOT EXISTS idx_s3_billing_metrics_bucket_collected_at
    ON public.s3_billing_metrics (bucket, collected_at DESC);
