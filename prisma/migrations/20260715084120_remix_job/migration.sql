-- CreateTable
CREATE TABLE "RemixJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "competitorCreativeId" TEXT,
    "creativeId" TEXT,
    "tier" TEXT NOT NULL DEFAULT 't0_5',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "brief" JSONB NOT NULL,
    "segmentPlan" JSONB,
    "beats" JSONB,
    "outputUrl" TEXT,
    "qcReport" JSONB,
    "costTokens" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemixJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemixJob_orgId_status_idx" ON "RemixJob"("orgId", "status");

-- CreateIndex
CREATE INDEX "RemixJob_orgId_createdAt_idx" ON "RemixJob"("orgId", "createdAt");
