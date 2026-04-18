CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Webhook_orgId_idx" ON "Webhook"("orgId");
ALTER TABLE "Webhook"
    ADD CONSTRAINT "Webhook_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
