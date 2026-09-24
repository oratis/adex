CREATE TABLE "AdjustReportSnapshot" (
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdjustReportSnapshot_pkey" PRIMARY KEY ("accountId")
);

CREATE INDEX "AdjustReportSnapshot_orgId_idx" ON "AdjustReportSnapshot"("orgId");
ALTER TABLE "AdjustReportSnapshot" ADD CONSTRAINT "AdjustReportSnapshot_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
