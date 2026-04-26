-- AlterTable
ALTER TABLE "User" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "InviteCode" ADD COLUMN     "batchLabel" TEXT;

-- CreateIndex
CREATE INDEX "InviteCode_batchLabel_idx" ON "InviteCode"("batchLabel");

