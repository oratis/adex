-- AlterTable
ALTER TABLE "CompetitorCreative" ADD COLUMN     "level" TEXT;

-- CreateIndex
CREATE INDEX "CompetitorCreative_orgId_level_idx" ON "CompetitorCreative"("orgId", "level");

