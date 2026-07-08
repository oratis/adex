-- CreateTable
CREATE TABLE "CompetitorCreative" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'appgrowing',
    "externalId" TEXT NOT NULL,
    "relevance" TEXT,
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
    "rawMeta" JSONB,
    "assetId" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorCreative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetitorCreative_orgId_appName_idx" ON "CompetitorCreative"("orgId", "appName");

-- CreateIndex
CREATE INDEX "CompetitorCreative_orgId_relevance_idx" ON "CompetitorCreative"("orgId", "relevance");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorCreative_orgId_source_externalId_key" ON "CompetitorCreative"("orgId", "source", "externalId");
