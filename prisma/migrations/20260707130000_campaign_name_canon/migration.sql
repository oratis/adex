-- Campaign-name canon (docs/growth/06-mmp-ingest.md §7) — agency / bid
-- strategy / conversion goal parsed from campaign_name, plus the agency
-- dimension on CohortSnapshot needed to join cohort attribution back to
-- Report spend by agency. Additive only.

-- AlterTable
ALTER TABLE "ConversionEvent" ADD COLUMN "agency" TEXT;
ALTER TABLE "ConversionEvent" ADD COLUMN "bidStrategy" TEXT;
ALTER TABLE "ConversionEvent" ADD COLUMN "conversionGoal" TEXT;

-- AlterTable
ALTER TABLE "CohortSnapshot" ADD COLUMN "agency" TEXT;

-- DropIndex (widen unique key to include agency — see schema.prisma
-- CohortSnapshot doc comment for the Postgres NULL-uniqueness caveat this
-- inherits, same as the `os` widening before it)
DROP INDEX "CohortSnapshot_orgId_appId_cohortDate_channel_os_key";

-- CreateIndex
CREATE UNIQUE INDEX "CohortSnapshot_orgId_appId_cohortDate_channel_os_agency_key" ON "CohortSnapshot"("orgId", "appId", "cohortDate", "channel", "os", "agency");
