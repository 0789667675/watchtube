-- Migration: 20261121220000_advertising_lifecycle_telemetry
-- Expands AdEventType to support the full IAB/VAST lifecycle without lossy mapping.
-- Adds session, placement, adId, and error tracking fields to AdEvent.
-- Indexes AdEvent by session, video, and timestamp for efficient audit and replay verification.

-- 1. Extend AdEventType enum with required lifecycle events
ALTER TYPE "AdEventType" ADD VALUE IF NOT EXISTS 'AD_LOADED';
ALTER TYPE "AdEventType" ADD VALUE IF NOT EXISTS 'AD_IMPRESSION';
ALTER TYPE "AdEventType" ADD VALUE IF NOT EXISTS 'AD_FIRST_QUARTILE';
ALTER TYPE "AdEventType" ADD VALUE IF NOT EXISTS 'AD_MIDPOINT';
ALTER TYPE "AdEventType" ADD VALUE IF NOT EXISTS 'AD_THIRD_QUARTILE';
ALTER TYPE "AdEventType" ADD VALUE IF NOT EXISTS 'AD_COMPLETED';
ALTER TYPE "AdEventType" ADD VALUE IF NOT EXISTS 'AD_SKIPPED';
ALTER TYPE "AdEventType" ADD VALUE IF NOT EXISTS 'AD_ERROR';

-- 2. Add telemetry session, placement, and diagnostic fields to AdEvent
ALTER TABLE "AdEvent" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "AdEvent" ADD COLUMN IF NOT EXISTS "placement" TEXT;
ALTER TABLE "AdEvent" ADD COLUMN IF NOT EXISTS "adId" TEXT;
ALTER TABLE "AdEvent" ADD COLUMN IF NOT EXISTS "errorCode" TEXT;
ALTER TABLE "AdEvent" ADD COLUMN IF NOT EXISTS "playbackTimeSeconds" DOUBLE PRECISION;

-- 3. Create high-performance query indexes on AdEvent
CREATE INDEX IF NOT EXISTS "AdEvent_sessionId_idx" ON "AdEvent"("sessionId");
CREATE INDEX IF NOT EXISTS "AdEvent_videoId_eventType_idx" ON "AdEvent"("videoId", "eventType");
CREATE INDEX IF NOT EXISTS "AdEvent_createdAt_idx" ON "AdEvent"("createdAt");

-- 4. Extend AdProviderConfig with provider type and supported placements
ALTER TABLE "AdProviderConfig" ADD COLUMN IF NOT EXISTS "providerType" TEXT NOT NULL DEFAULT 'VAST_GENERIC';
ALTER TABLE "AdProviderConfig" ADD COLUMN IF NOT EXISTS "supportedPlacements" TEXT[] DEFAULT ARRAY['PRE_ROLL']::TEXT[];
