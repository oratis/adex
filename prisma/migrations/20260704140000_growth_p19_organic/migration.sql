-- Growth OS (P19) — organic attribution: KOL partnerships + app reviews.
-- Three additive tables; no changes to existing tables.

-- CreateTable
CREATE TABLE "CreatorPartnership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'negotiating',
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contractNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorPartnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPost" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "baselineInstalls" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "upliftInstalls" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effectiveCpi" DOUBLE PRECISION,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppReview" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "appId" TEXT,
    "source" TEXT NOT NULL,
    "country" TEXT,
    "rating" INTEGER,
    "title" TEXT,
    "body" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "sentiment" TEXT,
    "topics" TEXT,
    "priority" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreatorPartnership_orgId_status_idx" ON "CreatorPartnership"("orgId", "status");

-- CreateIndex
CREATE INDEX "CreatorPost_partnershipId_idx" ON "CreatorPost"("partnershipId");

-- CreateIndex
CREATE INDEX "AppReview_orgId_sentiment_reviewedAt_idx" ON "AppReview"("orgId", "sentiment", "reviewedAt");

-- CreateIndex
CREATE INDEX "AppReview_orgId_reviewedAt_idx" ON "AppReview"("orgId", "reviewedAt");

-- AddForeignKey
ALTER TABLE "CreatorPartnership" ADD CONSTRAINT "CreatorPartnership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPost" ADD CONSTRAINT "CreatorPost_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "CreatorPartnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppReview" ADD CONSTRAINT "AppReview_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
