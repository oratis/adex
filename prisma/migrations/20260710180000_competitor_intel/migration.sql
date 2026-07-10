-- CreateTable
CREATE TABLE "CompetitorCreative" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'appgrowing',
    "externalId" TEXT NOT NULL,
    "appName" TEXT,
    "advertiser" TEXT,
    "mediaPlatforms" JSONB,
    "adFormat" TEXT,
    "region" TEXT,
    "language" TEXT,
    "adDays" INTEGER,
    "impressions" BIGINT,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "originalPostUrl" TEXT,
    "ratio" TEXT,
    "duration" INTEGER,
    "creativeTags" JSONB,
    "sellingPoints" JSONB,
    "emotionalTriggers" JSONB,
    "screenUnderstanding" JSONB,
    "storyboard" JSONB,
    "transcript" TEXT,
    "bgm" TEXT,
    "aiPrompt" TEXT,
    "segmentPlan" JSONB,
    "rawMeta" JSONB,
    "assetId" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorCreative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemixJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "competitorCreativeId" TEXT NOT NULL,
    "briefId" TEXT,
    "mode" TEXT NOT NULL,
    "remixPrompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "assetId" TEXT,
    "creativeId" TEXT,
    "aiPointsSpent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemixJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetitorCreative_orgId_appName_idx" ON "CompetitorCreative"("orgId", "appName");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorCreative_orgId_source_externalId_key" ON "CompetitorCreative"("orgId", "source", "externalId");

-- CreateIndex
CREATE INDEX "RemixJob_orgId_status_idx" ON "RemixJob"("orgId", "status");

-- AddForeignKey
ALTER TABLE "CompetitorCreative" ADD CONSTRAINT "CompetitorCreative_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemixJob" ADD CONSTRAINT "RemixJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

