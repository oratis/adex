-- Persist the competitor's own media URL captured at ingest, so Tier-2 "Save video"
-- has a source without a fresh manual paste. Nullable — backfilled going forward.
ALTER TABLE "CompetitorCreative" ADD COLUMN "mediaUrl" TEXT;
