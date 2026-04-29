-- CreateTable
CREATE TABLE "CronSecret" (
    "id" TEXT NOT NULL,
    "cronPath" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CronSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CronSecret_cronPath_key" ON "CronSecret"("cronPath");

-- CreateIndex
CREATE INDEX "CronSecret_isActive_idx" ON "CronSecret"("isActive");

