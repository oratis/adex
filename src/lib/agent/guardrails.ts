/**
 * Guardrail evaluators (Phase 14 wiring; Phase 13 ships only the framework so
 * the act() flow can call into a stable interface).
 *
 * A guardrail returns `{ pass, reason }` per ProposedDecisionStep. `act()`
 * blocks any step where ANY guardrail returns `pass=false`.
 */
import { prisma } from '@/lib/prisma'
import type { ProposedDecisionStep, ToolDefinition } from './types'

export type GuardrailEvalResult = {
  pass: boolean
  rule: string
  reason?: string
  config?: unknown
}

export type GuardrailContext = {
  orgId: string
  step: ProposedDecisionStep
  tool: ToolDefinition<unknown>
}

type GuardrailEvaluator = (ctx: GuardrailContext, config: unknown) => Promise<GuardrailEvalResult>

const evaluators: Record<string, GuardrailEvaluator> = {
  // === Built-in defaults — applied even if no Guardrail row exists ===

  /**
   * Hard cap on what a single step can spend per day. Triggered for
   * adjust_daily_budget when newDailyBudget exceeds the cap.
   */
  budget_max_daily: async (ctx, config) => {
    if (ctx.step.tool !== 'adjust_daily_budget')
      return { pass: true, rule: 'budget_max_daily' }
    const cfg = (config || {}) as { max?: number }
    const max = typeof cfg.max === 'number' ? cfg.max : 1000
    const newBudget = Number((ctx.step.input as Record<string, unknown>).newDailyBudget)
    if (Number.isFinite(newBudget) && newBudget > max) {
      return {
        pass: false,
        rule: 'budget_max_daily',
        reason: `newDailyBudget ${newBudget} exceeds cap ${max}`,
        config,
      }
    }
    return { pass: true, rule: 'budget_max_daily' }
  },

  /**
   * Cap on how much a single budget change can move (percentage of previous).
   */
  budget_change_pct: async (ctx, config) => {
    if (ctx.step.tool !== 'adjust_daily_budget')
      return { pass: true, rule: 'budget_change_pct' }
    const cfg = (config || {}) as { maxIncreasePct?: number; maxDecreasePct?: number }
    const input = ctx.step.input as Record<string, unknown>
    const prev = Number(input.previousDailyBudget)
    const next = Number(input.newDailyBudget)
    if (!Number.isFinite(prev) || prev <= 0) return { pass: true, rule: 'budget_change_pct' }
    if (!Number.isFinite(next) || next < 0) return { pass: true, rule: 'budget_change_pct' }
    const pctChange = ((next - prev) / prev) * 100
    const maxIncrease = cfg.maxIncreasePct ?? 50
    const maxDecrease = cfg.maxDecreasePct ?? 70
    if (pctChange > maxIncrease) {
      return {
        pass: false,
        rule: 'budget_change_pct',
        reason: `+${pctChange.toFixed(1)}% > +${maxIncrease}% cap`,
        config,
      }
    }
    if (-pctChange > maxDecrease) {
      return {
        pass: false,
        rule: 'budget_change_pct',
        reason: `${pctChange.toFixed(1)}% > -${maxDecrease}% cap`,
        config,
      }
    }
    return { pass: true, rule: 'budget_change_pct' }
  },

  /**
   * Some status changes always require approval (configurable list).
   */
  status_change: async (ctx, config) => {
    const cfg = (config || {}) as { requireApprovalFor?: string[] }
    const list = cfg.requireApprovalFor || ['resume_campaign']
    if (list.includes(ctx.step.tool)) {
      return {
        pass: false,
        rule: 'status_change',
        reason: `${ctx.step.tool} requires approval per status_change rule`,
        config,
      }
    }
    return { pass: true, rule: 'status_change' }
  },

  /**
   * High-risk tools default to requiring approval unless explicitly allowed.
   */
  high_risk_requires_approval: async (ctx) => {
    if (ctx.tool.riskLevel === 'high') {
      return {
        pass: false,
        rule: 'high_risk_requires_approval',
        reason: `${ctx.step.tool} is high-risk; approval required`,
      }
    }
    return { pass: true, rule: 'high_risk_requires_approval' }
  },

  /**
   * Org-level: only operate during configured "active hours" (UTC).
   */
  agent_active_hours: async (_ctx, config) => {
    const cfg = (config || {}) as { startHourUtc?: number; endHourUtc?: number }
    const start = cfg.startHourUtc ?? 0
    const end = cfg.endHourUtc ?? 24
    const hour = new Date().getUTCHours()
    if (hour < start || hour >= end) {
      return {
        pass: false,
        rule: 'agent_active_hours',
        reason: `Current hour ${hour} UTC outside [${start}, ${end})`,
        config,
      }
    }
    return { pass: true, rule: 'agent_active_hours' }
  },

  /**
   * Hard ceiling on the org's monthly LLM spend (read from AgentConfig).
   */
  llm_budget_cap: async (ctx) => {
    const cfg = await prisma.agentConfig.findUnique({ where: { orgId: ctx.orgId } })
    if (!cfg) return { pass: true, rule: 'llm_budget_cap' }
    if (cfg.monthlyLlmSpentUsd >= cfg.monthlyLlmBudgetUsd) {
      return {
        pass: false,
        rule: 'llm_budget_cap',
        reason: `Monthly LLM budget exhausted ($${cfg.monthlyLlmSpentUsd.toFixed(2)} / $${cfg.monthlyLlmBudgetUsd})`,
      }
    }
    return { pass: true, rule: 'llm_budget_cap' }
  },

  /**
   * Per-org: don't auto-act on campaigns that haven't been opted in.
   */
  managed_only: async (ctx, _config) => {
    const input = ctx.step.input as Record<string, unknown>
    const cid = input.campaignId
    if (typeof cid !== 'string') return { pass: true, rule: 'managed_only' }
    const c = await prisma.campaign.findFirst({
      where: { id: cid, orgId: ctx.orgId },
      select: { managedByAgent: true },
    })
    if (!c) return { pass: true, rule: 'managed_only' }
    if (!c.managedByAgent) {
      return {
        pass: false,
        rule: 'managed_only',
        reason: `Campaign ${cid} has managedByAgent=false`,
      }
    }
    return { pass: true, rule: 'managed_only' }
  },

  /**
   * Don't propose a step that exactly mirrors one already taken in the last
   * cooldown_hours hours (default 4) — prevents flapping.
   */
  cooldown: async (ctx, config) => {
    const cfg = (config || {}) as { hours?: number }
    const hours = cfg.hours ?? 4
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)
    const recent = await prisma.decisionStep.findFirst({
      where: {
        toolName: ctx.step.tool,
        decision: { orgId: ctx.orgId },
        executedAt: { gte: since },
        status: 'executed',
      },
      orderBy: { executedAt: 'desc' },
    })
    if (!recent) return { pass: true, rule: 'cooldown' }
    // Naive payload comparison
    if (recent.toolInput === JSON.stringify(ctx.step.input)) {
      return {
        pass: false,
        rule: 'cooldown',
        reason: `Same step executed within last ${hours}h`,
      }
    }
    return { pass: true, rule: 'cooldown' }
  },

  /**
   * Don't pause a campaign if it spent > X in last 24h without sufficient
   * conversions data (avoids killing a winner during a noisy hour).
   */
  pause_only_with_conversions: async (ctx, config) => {
    if (ctx.step.tool !== 'pause_campaign')
      return { pass: true, rule: 'pause_only_with_conversions' }
    const cfg = (config || {}) as { minSpendThreshold?: number; minImpressionsForSignal?: number }
    const minSpend = cfg.minSpendThreshold ?? 50
    const minImps = cfg.minImpressionsForSignal ?? 2000
    const cid = (ctx.step.input as Record<string, unknown>).campaignId
    if (typeof cid !== 'string') return { pass: true, rule: 'pause_only_with_conversions' }
    const link = await prisma.platformLink.findFirst({
      where: { orgId: ctx.orgId, entityType: 'campaign', localEntityId: cid },
    })
    if (!link) return { pass: true, rule: 'pause_only_with_conversions' }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const reports = await prisma.report.findMany({
      where: { campaignLinkId: link.id, level: 'campaign', date: { gte: since } },
    })
    const spend = reports.reduce((s, r) => s + r.spend, 0)
    const imps = reports.reduce((s, r) => s + r.impressions, 0)
    if (spend < minSpend && imps < minImps) {
      return {
        pass: false,
        rule: 'pause_only_with_conversions',
        reason: `Insufficient signal: 24h spend $${spend.toFixed(2)}, impressions ${imps}`,
      }
    }
    return { pass: true, rule: 'pause_only_with_conversions' }
  },

  /**
   * Per-tool max executions per day across the org.
   */
  max_per_day: async (ctx, config) => {
    const cfg = (config || {}) as { max?: number }
    const max = cfg.max ?? 20
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const count = await prisma.decisionStep.count({
      where: {
        toolName: ctx.step.tool,
        decision: { orgId: ctx.orgId },
        executedAt: { gte: since },
        status: 'executed',
      },
    })
    if (count >= max) {
      return {
        pass: false,
        rule: 'max_per_day',
        reason: `Tool ${ctx.step.tool} already executed ${count} times in last 24h (cap ${max})`,
        config,
      }
    }
    return { pass: true, rule: 'max_per_day' }
  },

  /**
   * Org-wide spend ceiling — sum across all active campaigns can't exceed cap.
   */
  budget_max_total_daily: async (ctx, config) => {
    if (ctx.step.tool !== 'adjust_daily_budget')
      return { pass: true, rule: 'budget_max_total_daily' }
    const cfg = (config || {}) as { max?: number }
    const max = typeof cfg.max === 'number' ? cfg.max : 5000
    const links = await prisma.platformLink.findMany({
      where: { orgId: ctx.orgId, entityType: 'campaign', status: 'active' },
    })
    let total = 0
    for (const link of links) {
      const last = await prisma.campaignSnapshot.findFirst({
        where: { platformLinkId: link.id },
        orderBy: { capturedAt: 'desc' },
      })
      if (last?.dailyBudget) total += last.dailyBudget
    }
    const newBudget = Number((ctx.step.input as Record<string, unknown>).newDailyBudget) || 0
    const prevBudget = Number((ctx.step.input as Record<string, unknown>).previousDailyBudget) || 0
    const projected = total - prevBudget + newBudget
    if (projected > max) {
      return {
        pass: false,
        rule: 'budget_max_total_daily',
        reason: `Projected org daily total $${projected.toFixed(0)} > cap $${max}`,
        config,
      }
    }
    return { pass: true, rule: 'budget_max_total_daily' }
  },

  /**
   * Reject any step whose impact value is above a threshold (default 200
   * USD/day moved). Pairs with budget_change_pct.
   */
  requires_approval_above_spend: async (ctx, config) => {
    const cfg = (config || {}) as { threshold?: number }
    const threshold = cfg.threshold ?? 200
    if (ctx.step.tool === 'adjust_daily_budget') {
      const input = ctx.step.input as Record<string, unknown>
      const prev = Number(input.previousDailyBudget) || 0
      const next = Number(input.newDailyBudget) || 0
      if (Math.abs(next - prev) >= threshold) {
        return {
          pass: false,
          rule: 'requires_approval_above_spend',
          reason: `Δ $${Math.abs(next - prev).toFixed(2)} ≥ approval threshold $${threshold}`,
        }
      }
    }
    return { pass: true, rule: 'requires_approval_above_spend' }
  },
}

const BUILTIN_DEFAULTS: Array<{ rule: string; config: unknown }> = [
  { rule: 'high_risk_requires_approval', config: {} },
  { rule: 'llm_budget_cap', config: {} },
  { rule: 'cooldown', config: { hours: 4 } },
  { rule: 'pause_only_with_conversions', config: { minSpendThreshold: 50, minImpressionsForSignal: 2000 } },
  { rule: 'max_per_day', config: { max: 20 } },
]

/**
 * Evaluate every applicable guardrail for a step. Returns the full report so
 * the DecisionStep can record exactly which rules matched. The step is
 * considered "blocked" iff ANY result has pass=false.
 */
export async function evaluateGuardrails(
  ctx: GuardrailContext
): Promise<GuardrailEvalResult[]> {
  const results: GuardrailEvalResult[] = []

  for (const def of BUILTIN_DEFAULTS) {
    const evaluator = evaluators[def.rule]
    if (!evaluator) continue
    try {
      results.push(await evaluator(ctx, def.config))
    } catch (err) {
      results.push({
        pass: true, // never block on evaluator failure — log and continue
        rule: def.rule,
        reason: `evaluator error: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  // Org-configured guardrails
  const orgRules = await prisma.guardrail.findMany({
    where: { orgId: ctx.orgId, isActive: true },
  })
  for (const g of orgRules) {
    const evaluator = evaluators[g.rule]
    if (!evaluator) continue
    let cfg: unknown = {}
    try {
      cfg = g.config ? JSON.parse(g.config) : {}
    } catch {
      cfg = {}
    }
    try {
      results.push(await evaluator(ctx, cfg))
    } catch (err) {
      results.push({
        pass: true,
        rule: g.rule,
        reason: `evaluator error: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  return results
}

export function isBlocked(results: GuardrailEvalResult[]): boolean {
  return results.some((r) => !r.pass)
}
