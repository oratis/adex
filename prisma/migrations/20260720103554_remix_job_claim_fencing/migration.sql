-- AlterTable
ALTER TABLE "RemixJob" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimToken" TEXT;

-- CreateIndex
CREATE INDEX "RemixJob_status_updatedAt_idx" ON "RemixJob"("status", "updatedAt");
