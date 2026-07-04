-- Creative Studio (P20) — DCO-style creative production.
-- Additive: two Creative columns + two new tables.

-- AlterTable
ALTER TABLE "Creative" ADD COLUMN "sourceRef" TEXT;
ALTER TABLE "Creative" ADD COLUMN "tags" TEXT;

-- CreateTable
CREATE TABLE "CreativeBrief" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "promotedAppId" TEXT,
    "product" TEXT NOT NULL,
    "audience" TEXT,
    "angle" TEXT,
    "platforms" TEXT NOT NULL,
    "languages" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreativeBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeVariant" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "hook" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "headline" TEXT,
    "primaryText" TEXT,
    "cta" TEXT,
    "creativeId" TEXT,
    "specStatus" TEXT NOT NULL DEFAULT 'pending',
    "specNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreativeVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreativeBrief_orgId_idx" ON "CreativeBrief"("orgId");

-- CreateIndex
CREATE INDEX "CreativeVariant_briefId_idx" ON "CreativeVariant"("briefId");

-- CreateIndex
CREATE INDEX "CreativeVariant_orgId_idx" ON "CreativeVariant"("orgId");

-- AddForeignKey
ALTER TABLE "CreativeBrief" ADD CONSTRAINT "CreativeBrief_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeBrief" ADD CONSTRAINT "CreativeBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeVariant" ADD CONSTRAINT "CreativeVariant_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "CreativeBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeVariant" ADD CONSTRAINT "CreativeVariant_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
