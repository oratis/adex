-- === Organizations / memberships / invites =================================

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

CREATE TABLE "OrgMembership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgMembership_orgId_userId_key" ON "OrgMembership"("orgId", "userId");
CREATE INDEX "OrgMembership_userId_idx" ON "OrgMembership"("userId");

ALTER TABLE "OrgMembership"
    ADD CONSTRAINT "OrgMembership_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "OrgMembership_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrgInvite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "tokenHash" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgInvite_tokenHash_key" ON "OrgInvite"("tokenHash");
CREATE INDEX "OrgInvite_orgId_idx" ON "OrgInvite"("orgId");
CREATE INDEX "OrgInvite_email_idx" ON "OrgInvite"("email");

ALTER TABLE "OrgInvite"
    ADD CONSTRAINT "OrgInvite_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === Backfill: create a personal org for every existing user, record ========
-- === user as OWNER member. Slug generated from first 8 chars of user id.

INSERT INTO "Organization" ("id", "name", "slug", "createdBy", "createdAt", "updatedAt")
SELECT
    'org_' || u.id,
    COALESCE(u.name, split_part(u.email, '@', 1)) || '''s workspace',
    'ws-' || substr(u.id, 1, 12),
    u.id,
    NOW(),
    NOW()
FROM "User" u;

INSERT INTO "OrgMembership" ("id", "orgId", "userId", "role", "createdAt")
SELECT
    'mem_' || u.id,
    'org_' || u.id,
    u.id,
    'owner',
    NOW()
FROM "User" u;

-- === Add orgId columns (nullable first) to scoped tables ====================

ALTER TABLE "PlatformAuth" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Campaign"     ADD COLUMN "orgId" TEXT;
ALTER TABLE "Creative"     ADD COLUMN "orgId" TEXT;
ALTER TABLE "Budget"       ADD COLUMN "orgId" TEXT;
ALTER TABLE "Report"       ADD COLUMN "orgId" TEXT;
ALTER TABLE "Asset"        ADD COLUMN "orgId" TEXT;

-- === Backfill orgId from the creator's personal org =========================

-- Resources created by real users map to that user's personal org.
-- Assets uploaded by non-user accounts (e.g. 'anonymous', 'gdrive-sync')
-- are adopted by the oldest org in the system — typically the first
-- admin — so they don't become unreachable.
UPDATE "PlatformAuth" pa SET "orgId" = 'org_' || pa."userId";
UPDATE "Campaign"     c  SET "orgId" = 'org_' || c."userId";
UPDATE "Creative"     cr SET "orgId" = 'org_' || cr."userId";
UPDATE "Budget"       b  SET "orgId" = 'org_' || b."userId";
UPDATE "Report"       r  SET "orgId" = 'org_' || r."userId";

UPDATE "Asset" a SET "orgId" = 'org_' || a."uploadedBy"
  WHERE a."uploadedBy" IN (SELECT id FROM "User");

UPDATE "Asset" a
  SET "orgId" = (SELECT id FROM "Organization" ORDER BY "createdAt" ASC LIMIT 1)
  WHERE a."uploadedBy" NOT IN (SELECT id FROM "User");

-- === Enforce NOT NULL + add FK + indexes ====================================

ALTER TABLE "PlatformAuth" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Campaign"     ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Creative"     ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Budget"       ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Report"       ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Asset"        ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "PlatformAuth"
    ADD CONSTRAINT "PlatformAuth_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Creative"
    ADD CONSTRAINT "Creative_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Budget"
    ADD CONSTRAINT "Budget_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Report"
    ADD CONSTRAINT "Report_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Asset"
    ADD CONSTRAINT "Asset_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PlatformAuth_userId_idx" ON "PlatformAuth"("userId");
CREATE INDEX "Campaign_orgId_idx"      ON "Campaign"("orgId");
CREATE INDEX "Campaign_userId_idx"     ON "Campaign"("userId");
CREATE INDEX "Creative_orgId_idx"      ON "Creative"("orgId");
CREATE INDEX "Creative_userId_idx"     ON "Creative"("userId");
CREATE INDEX "Budget_orgId_idx"        ON "Budget"("orgId");
CREATE INDEX "Budget_userId_idx"       ON "Budget"("userId");
CREATE INDEX "Report_orgId_idx"        ON "Report"("orgId");
CREATE INDEX "Report_userId_idx"       ON "Report"("userId");
CREATE INDEX "Asset_orgId_idx"         ON "Asset"("orgId");

-- === Swap PlatformAuth uniqueness: (userId, platform) → (orgId, platform) ==

ALTER TABLE "PlatformAuth" DROP CONSTRAINT IF EXISTS "PlatformAuth_userId_platform_key";
DROP INDEX IF EXISTS "PlatformAuth_userId_platform_key";
CREATE UNIQUE INDEX "PlatformAuth_orgId_platform_key" ON "PlatformAuth"("orgId", "platform");
