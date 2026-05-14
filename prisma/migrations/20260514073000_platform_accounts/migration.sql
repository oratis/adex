-- Multi-account-per-workspace support.
--
-- PlatformAuth stays as the org+platform "connection" (OAuth refresh token,
-- API token, etc.). A new PlatformAccount table lists every ad-platform
-- account exposed by that connection (Google customer IDs under one MCC,
-- TikTok advertisers, Adjust apps, etc.). The PlatformAuth.accountId column
-- continues to mirror the row marked isPrimary=true so the ~20 single-account
-- read sites in adapters/agent tools keep working unchanged.

CREATE TABLE "PlatformAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "displayName" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "extra" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAccount_orgId_platform_accountId_key"
    ON "PlatformAccount"("orgId", "platform", "accountId");

CREATE INDEX "PlatformAccount_orgId_platform_isPrimary_idx"
    ON "PlatformAccount"("orgId", "platform", "isPrimary");

ALTER TABLE "PlatformAccount"
    ADD CONSTRAINT "PlatformAccount_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
