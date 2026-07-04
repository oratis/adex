-- Growth OS (P18) foundation — the measurement spine for the Cuddler pilot.
--
-- Four additive tables (no changes to existing tables):
--   PromotedApp      apps under promotion (Cuddler iOS = first row)
--   ConversionEvent  normalized funnel events from GA4 / RevenueCat / deeplink
--   CohortSnapshot   per-acquisition-day x channel cohort, recomputed daily
--   GrowthMetric     non-cohort metrics (k-factor, weekly shares, ASO rank)
--
-- Design ref: docs/growth/00-cuddler-first-redesign.md §4
-- All FKs cascade from Organization so deleting a workspace clears its growth data.

-- CreateTable
CREATE TABLE "PromotedApp" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "bundleId" TEXT,
    "storeId" TEXT,
    "deepLinkDomain" TEXT,
    "skanEnabled" BOOLEAN NOT NULL DEFAULT true,
    "extra" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromotedApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversionEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "appId" TEXT,
    "source" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "userKey" TEXT,
    "utmSource" TEXT,
    "utmCampaign" TEXT,
    "channel" TEXT,
    "country" TEXT,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "raw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CohortSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "appId" TEXT,
    "cohortDate" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installs" INTEGER NOT NULL DEFAULT 0,
    "activated" INTEGER NOT NULL DEFAULT 0,
    "d1Retained" INTEGER NOT NULL DEFAULT 0,
    "d7Retained" INTEGER NOT NULL DEFAULT 0,
    "trials" INTEGER NOT NULL DEFAULT 0,
    "subscribers" INTEGER NOT NULL DEFAULT 0,
    "revenueToDate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ltvEstimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cac" DOUBLE PRECISION,
    CONSTRAINT "CohortSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthMetric" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL,
    "channel" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "dims" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrowthMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromotedApp_orgId_platform_bundleId_key" ON "PromotedApp"("orgId", "platform", "bundleId");

-- CreateIndex
CREATE INDEX "PromotedApp_orgId_idx" ON "PromotedApp"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversionEvent_orgId_source_eventName_userKey_occurredAt_key" ON "ConversionEvent"("orgId", "source", "eventName", "userKey", "occurredAt");

-- CreateIndex
CREATE INDEX "ConversionEvent_orgId_eventName_occurredAt_idx" ON "ConversionEvent"("orgId", "eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "ConversionEvent_orgId_channel_occurredAt_idx" ON "ConversionEvent"("orgId", "channel", "occurredAt");

-- CreateIndex
CREATE INDEX "ConversionEvent_appId_idx" ON "ConversionEvent"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "CohortSnapshot_orgId_appId_cohortDate_channel_key" ON "CohortSnapshot"("orgId", "appId", "cohortDate", "channel");

-- CreateIndex
CREATE INDEX "CohortSnapshot_orgId_cohortDate_idx" ON "CohortSnapshot"("orgId", "cohortDate");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthMetric_orgId_date_metric_channel_key" ON "GrowthMetric"("orgId", "date", "metric", "channel");

-- CreateIndex
CREATE INDEX "GrowthMetric_orgId_date_idx" ON "GrowthMetric"("orgId", "date");

-- AddForeignKey
ALTER TABLE "PromotedApp" ADD CONSTRAINT "PromotedApp_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionEvent" ADD CONSTRAINT "ConversionEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CohortSnapshot" ADD CONSTRAINT "CohortSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthMetric" ADD CONSTRAINT "GrowthMetric_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
