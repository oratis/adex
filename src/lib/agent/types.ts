/**
 * Shared types for the Agent runtime.
 */
import type { Decision, DecisionStep, AgentConfig } from '@/generated/prisma/client'

export type AgentMode = 'shadow' | 'approval_only' | 'autonomous'

export type Severity = 'info' | 'opportunity' | 'warning' | 'alert'

export type ToolRiskLevel = 'low' | 'medium' | 'high'

export type CampaignSummary = {
  id: string
  name: string
  platform: string
  desiredStatus: string
  syncedStatus: string | null
  managedByAgent: boolean
  // last 7d aggregated metrics from Report level=campaign
  metrics7d: {
    impressions: number
    clicks: number
    spend: number
    conversions: number
    revenue: number
    ctr: number
    roas: number
  }
  // last 24h aggregated
  metrics1d: {
    impressions: number
    spend: number
    conversions: number
    revenue: number
    roas: number
  }
  platformCampaignId: string | null
  dailyBudget: number | null
}

export type PerceiveSnapshot = {
  orgId: string
  takenAt: string
  campaigns: CampaignSummary[]
  recentDecisions: Array<{
    id: string
    rationale: string
    severity: Severity
    status: string
    createdAt: string
    classification?: string | null
  }>
  guardrailHints: string[]
}

export type ProposedDecisionStep = {
  tool: string
  input: Record<string, unknown>
  reason?: string
}

export type ProposedDecision = {
  rationale: string
  severity: Severity
  steps: ProposedDecisionStep[]
}

export type PlanResult = {
  decisions: ProposedDecision[]
  llm: {
    model: string
    inputTokens: number
    outputTokens: number
    costUsd: number
    requestId?: string
  }
}

export type ToolContext = {
  orgId: string
  decisionId: string
  stepIndex: number
  mode: AgentMode
}

export type ToolResultOk = {
  ok: true
  output: Record<string, unknown>
  platformLinkId?: string
  platformResponse?: unknown
}

export type ToolResultErr = {
  ok: false
  error: string
  code?: string
}

export type ToolResult = ToolResultOk | ToolResultErr

export type ToolDefinition<I = unknown> = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  reversible: boolean
  riskLevel: ToolRiskLevel
  validate(input: unknown): I
  execute(ctx: ToolContext, input: I): Promise<ToolResult>
  /**
   * If reversible, return the inverse step that would undo this one. Used
   * by the auto-rollback registry (P14). Null = no inverse known.
   */
  inverse?(input: I): ProposedDecisionStep | null
}

export type AgentRunResult = {
  orgId: string
  decisionsCreated: number
  decisionsExecuted: number
  decisionsSkipped: number
  decisionsAwaitingApproval: number
  llmCostUsd: number
  errors: string[]
}

// Re-export Prisma types for convenience.
export type { Decision, DecisionStep, AgentConfig }
