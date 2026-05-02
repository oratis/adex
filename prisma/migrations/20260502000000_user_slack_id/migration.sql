-- Audit Critical #4 — wire Slack interactive approvals to a real Adex
-- user via slackUserId. NULLABLE so existing users don't break; UNIQUE so
-- two Adex accounts can't claim the same Slack identity.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "slackUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_slackUserId_key" ON "User"("slackUserId");
