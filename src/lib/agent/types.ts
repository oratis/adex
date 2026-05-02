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

export type PlanValidationDrop = {
  kind: string
  detail: string
}

export type PlanResult = {
  decisions: ProposedDecision[]
  /**
   * Validation drops surfaced from the LLM tool-use response. Each entry
   * describes a step or decision that was silently filtered out before we
   * persisted it. Surfaced in Decision.perceiveContext for debuggability
   * (audit High #13).
   */
  drops?: PlanValidationDrop[]
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
  /**
   * If true, executing this tool produces undefined behaviour when the
   * preceding step in the same Decision failed. The act() runner uses this
   * to short-circuit downstream steps after a failure (audit High #12).
   * Default false — most tools are independent.
   */
  dependsOnPriorSuccess?: boolean
  /**
   * If true, the tool's `inverse()` requires `previousX` fields in the
   * input to be filled in. UI uses this to badge steps that can't be
   * rolled back without those fields (audit High #14).
   */
  requiresPriorState?: boolean
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
