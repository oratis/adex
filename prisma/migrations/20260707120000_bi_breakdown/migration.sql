-- BI breakdown (docs/growth/06-mmp-ingest.md §6) — os dimension + signup-anchored
-- cohort fields + agency dimension on Report/PlatformAccount. Additive only.

-- AlterTable
ALTER TABLE "ConversionEvent" ADD COLUMN "os" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN "os" TEXT;
ALTER TABLE "Report" ADD COLUMN "agency" TEXT;

-- AlterTable
ALTER TABLE "PlatformAccount" ADD COLUMN "agency" TEXT;

-- AlterTable
ALTER TABLE "CohortSnapshot" ADD COLUMN "os" TEXT;
ALTER TABLE "CohortSnapshot" ADD COLUMN "signups" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CohortSnapshot" ADD COLUMN "revenueD0" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "CohortSnapshot" ADD COLUMN "revenueD7" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- DropIndex (widen unique key to include os — see schema.prisma CohortSnapshot
-- doc comment for the Postgres NULL-uniqueness caveat this inherits)
DROP INDEX "CohortSnapshot_orgId_appId_cohortDate_channel_key";

-- CreateIndex
CREATE UNIQUE INDEX "CohortSnapshot_orgId_appId_cohortDate_channel_os_key" ON "CohortSnapshot"("orgId", "appId", "cohortDate", "channel", "os");
