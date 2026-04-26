-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "desiredStatus" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN     "managedByAgent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "syncError" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3),
ADD COLUMN     "syncedStatus" TEXT;

-- AlterTable
ALTER TABLE "Ad" ADD COLUMN     "platformPolicyNote" TEXT,
ADD COLUMN     "platformPolicyStatus" TEXT;

-- AlterTable
ALTER TABLE "Creative" ADD COLUMN     "platformAssetId" TEXT,
ADD COLUMN     "platformPolicy" TEXT,
ADD COLUMN     "reviewNotes" TEXT,
ADD COLUMN     "reviewStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "adGroupLinkId" TEXT,
ADD COLUMN     "adLinkId" TEXT,
ADD COLUMN     "campaignLinkId" TEXT,
ADD COLUMN     "level" TEXT NOT NULL DEFAULT 'account';

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "succeededAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "localEntityId" TEXT NOT NULL,
    "platformEntityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSyncedAt" TIMESTAMP(3),
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platformLinkId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "dailyBudget" DOUBLE PRECISION,
    "lifetimeBudget" DOUBLE PRECISION,
    "bidStrategy" TEXT,
    "targeting" TEXT,
    "raw" TEXT NOT NULL,

    CONSTRAINT "CampaignSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "perceiveContext" TEXT NOT NULL,
    "promptVersion" TEXT,
    "llmRequestId" TEXT,
    "llmInputTokens" INTEGER,
    "llmOutputTokens" INTEGER,
    "llmCostUsd" DOUBLE PRECISION,
    "rationale" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'shadow',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionStep" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolInput" TEXT NOT NULL,
    "toolOutput" TEXT,
    "status" TEXT NOT NULL,
    "guardrailReport" TEXT,
    "platformResponse" TEXT,
    "platformLinkId" TEXT,
    "reversible" BOOLEAN NOT NULL DEFAULT false,
    "rollbackOf" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionOutcome" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "windowHours" INTEGER NOT NULL,
    "metricsBefore" TEXT NOT NULL,
    "metricsAfter" TEXT NOT NULL,
    "delta" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guardrail" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "rule" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guardrail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingApproval" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "notifiedVia" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'shadow',
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchReason" TEXT,
    "killSwitchAt" TIMESTAMP(3),
    "monthlyLlmBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "monthlyLlmSpentUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "budgetResetAt" TIMESTAMP(3),
    "autonomousAllowed" BOOLEAN NOT NULL DEFAULT false,
    "autonomousAllowedAt" TIMESTAMP(3),
    "autonomousAllowedBy" TEXT,
    "shadowStartedAt" TIMESTAMP(3),
    "approvalOnlyStartedAt" TIMESTAMP(3),
    "autonomousStartedAt" TIMESTAMP(3),
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignLinkId" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "primaryMetric" TEXT NOT NULL,
    "minSampleSize" INTEGER NOT NULL DEFAULT 1000,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentArm" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adLinkId" TEXT NOT NULL,
    "trafficShare" DOUBLE PRECISION NOT NULL,
    "metricsSnapshot" TEXT,

    CONSTRAINT "ExperimentArm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isExperimental" BOOLEAN NOT NULL DEFAULT false,
    "experimentalSharePct" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptRun" (
    "id" TEXT NOT NULL,
    "promptVersionId" TEXT NOT NULL,
    "decisionId" TEXT,
    "inputHash" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "rawOutput" TEXT NOT NULL,
    "parsed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDelivery_nextAttemptAt_succeededAt_abandonedAt_idx" ON "WebhookDelivery"("nextAttemptAt", "succeededAt", "abandonedAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_idx" ON "WebhookDelivery"("webhookId");

-- CreateIndex
CREATE INDEX "PlatformLink_orgId_entityType_localEntityId_idx" ON "PlatformLink"("orgId", "entityType", "localEntityId");

-- CreateIndex
CREATE INDEX "PlatformLink_orgId_platform_status_idx" ON "PlatformLink"("orgId", "platform", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformLink_platform_accountId_platformEntityId_entityType_key" ON "PlatformLink"("platform", "accountId", "platformEntityId", "entityType");

-- CreateIndex
CREATE INDEX "CampaignSnapshot_platformLinkId_capturedAt_idx" ON "CampaignSnapshot"("platformLinkId", "capturedAt");

-- CreateIndex
CREATE INDEX "CampaignSnapshot_orgId_capturedAt_idx" ON "CampaignSnapshot"("orgId", "capturedAt");

-- CreateIndex
CREATE INDEX "Decision_orgId_createdAt_idx" ON "Decision"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Decision_orgId_status_idx" ON "Decision"("orgId", "status");

-- CreateIndex
CREATE INDEX "Decision_status_idx" ON "Decision"("status");

-- CreateIndex
CREATE INDEX "DecisionStep_decisionId_stepIndex_idx" ON "DecisionStep"("decisionId", "stepIndex");

-- CreateIndex
CREATE INDEX "DecisionStep_toolName_status_idx" ON "DecisionStep"("toolName", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionOutcome_decisionId_key" ON "DecisionOutcome"("decisionId");

-- CreateIndex
CREATE INDEX "Guardrail_orgId_scope_scopeId_idx" ON "Guardrail"("orgId", "scope", "scopeId");

-- CreateIndex
CREATE INDEX "Guardrail_orgId_rule_isActive_idx" ON "Guardrail"("orgId", "rule", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PendingApproval_decisionId_key" ON "PendingApproval"("decisionId");

-- CreateIndex
CREATE INDEX "PendingApproval_orgId_expiresAt_idx" ON "PendingApproval"("orgId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConfig_orgId_key" ON "AgentConfig"("orgId");

-- CreateIndex
CREATE INDEX "Experiment_orgId_status_idx" ON "Experiment"("orgId", "status");

-- CreateIndex
CREATE INDEX "ExperimentArm_experimentId_idx" ON "ExperimentArm"("experimentId");

-- CreateIndex
CREATE INDEX "PromptVersion_name_isDefault_idx" ON "PromptVersion"("name", "isDefault");

-- CreateIndex
CREATE INDEX "PromptVersion_name_isExperimental_idx" ON "PromptVersion"("name", "isExperimental");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_name_version_key" ON "PromptVersion"("name", "version");

-- CreateIndex
CREATE INDEX "PromptRun_promptVersionId_createdAt_idx" ON "PromptRun"("promptVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptRun_decisionId_idx" ON "PromptRun"("decisionId");

-- CreateIndex
CREATE INDEX "Campaign_orgId_managedByAgent_idx" ON "Campaign"("orgId", "managedByAgent");

-- CreateIndex
CREATE INDEX "Creative_orgId_reviewStatus_idx" ON "Creative"("orgId", "reviewStatus");

-- CreateIndex
CREATE INDEX "Report_orgId_level_date_idx" ON "Report"("orgId", "level", "date");

-- CreateIndex
CREATE INDEX "Report_campaignLinkId_date_idx" ON "Report"("campaignLinkId", "date");

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_campaignLinkId_fkey" FOREIGN KEY ("campaignLinkId") REFERENCES "PlatformLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_adGroupLinkId_fkey" FOREIGN KEY ("adGroupLinkId") REFERENCES "PlatformLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_adLinkId_fkey" FOREIGN KEY ("adLinkId") REFERENCES "PlatformLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformLink" ADD CONSTRAINT "PlatformLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSnapshot" ADD CONSTRAINT "CampaignSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSnapshot" ADD CONSTRAINT "CampaignSnapshot_platformLinkId_fkey" FOREIGN KEY ("platformLinkId") REFERENCES "PlatformLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionStep" ADD CONSTRAINT "DecisionStep_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionStep" ADD CONSTRAINT "DecisionStep_platformLinkId_fkey" FOREIGN KEY ("platformLinkId") REFERENCES "PlatformLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionOutcome" ADD CONSTRAINT "DecisionOutcome_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardrail" ADD CONSTRAINT "Guardrail_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingApproval" ADD CONSTRAINT "PendingApproval_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingApproval" ADD CONSTRAINT "PendingApproval_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfig" ADD CONSTRAINT "AgentConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentArm" ADD CONSTRAINT "ExperimentArm_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptRun" ADD CONSTRAINT "PromptRun_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "PromptVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

