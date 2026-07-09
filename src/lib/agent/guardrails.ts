/**
 * Guardrail evaluators (Phase 14 wiring; Phase 13 ships only the framework so
 * the act() flow can call into a stable interface).
 *
 * A guardrail returns `{ pass, reason }` per ProposedDecisionStep. `act()`
 * blocks any step where ANY guardrail returns `pass=false`.
 */
import { prisma } from '@/lib/prisma'
import type { ProposedDecisionStep, ToolDefinition } from './types'
import {
  evaluatePilotBudget,
  tierCacCeiling,
  withinCacCeiling,
  LEARNING_PHASE_DAYS,
  LEARNING_PHASE_HARD_MULTIPLE,
} from '@/lib/growth/budget-guard'
import { FIRST_MONTH_NET_DEFAULT } from '@/lib/growth/pilot-gates'

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
   *
   * Reads BOTH `startHourUtc/endHourUtc` (canonical, written by guardrails
   * UI after local→UTC conversion) AND falls back to `startHourLocal/
   * endHourLocal` if only those exist (manual SQL inserts, older form
   * versions). Audit Critical #2 — without the fallback, a config row that
   * only has the *Local fields silently passed every check.
   */
  agent_active_hours: async (_ctx, config) => {
    const cfg = (config || {}) as {
      startHourUtc?: number
      endHourUtc?: number
      startHourLocal?: number
      endHourLocal?: number
    }
    const start = cfg.startHourUtc ?? cfg.startHourLocal ?? 0
    const end = cfg.endHourUtc ?? cfg.endHourLocal ?? 24
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

  /**
   * Growth pilot ($5K cap) — hard org-wide spend ceiling for any step that
   * increases spend. Inert unless an org explicitly sets `pilotStartDate` in
   * this rule's config (there is no default pilotStartDate) — this keeps
   * existing non-pilot customers unaffected. See src/lib/growth/budget-guard.ts.
   */
  pilot_budget_cap: async (ctx, config) => {
    if (!isSpendIncreaseTool(ctx.step)) return { pass: true, rule: 'pilot_budget_cap' }
    const cfg = (config || {}) as { pilotStartDate?: string; capTotal?: number }
    if (!cfg.pilotStartDate) return { pass: true, rule: 'pilot_budget_cap' }
    const since = new Date(cfg.pilotStartDate)
    // level:'account' — sync writes BOTH an account-level row (the contract,
    // one per platform per day) AND best-effort per-campaign rows for the
    // same spend (src/lib/sync/report-writer.ts). Summing all levels double-
    // counts and trips the cap at ~half real spend.
    const reports = await prisma.report.findMany({
      where: { orgId: ctx.orgId, level: 'account', date: { gte: since } },
      select: { spend: true },
    })
    const cumulativeSpend = reports.reduce((s, r) => s + r.spend, 0)
    const result = evaluatePilotBudget({ cumulativeSpend, capTotal: cfg.capTotal })
    if (result.action === 'auto_pause') {
      return {
        pass: false,
        rule: 'pilot_budget_cap',
        reason: `pilot spend ${(result.pct * 100).toFixed(0)}% of cap: ${result.reasons.join('; ')}`,
        config,
      }
    }
    if (result.action === 'warn') {
      return {
        pass: true,
        rule: 'pilot_budget_cap',
        reason: `pilot spend ${(result.pct * 100).toFixed(0)}% of cap: ${result.reasons.join('; ')}`,
      }
    }
    return { pass: true, rule: 'pilot_budget_cap' }
  },

  /**
   * SKAN-attributed iOS install channels (meta/tiktok app_install) have
   * delayed, low-trust attribution for the first 72h, and are only
   * "learning phase" quality through day 7. Reject automated adjustments on
   * a too-young campaign; warn (don't block) during the learning window
   * unless spend is running away.
   */
  skan_maturity: async (ctx, _config) => {
    const skanTools = new Set([
      'adjust_bid',
      'adjust_daily_budget',
      'adjust_targeting_geo',
      'adjust_targeting_demo',
      'enable_smart_bidding',
    ])
    if (!skanTools.has(ctx.step.tool)) return { pass: true, rule: 'skan_maturity' }
    const cid = (ctx.step.input as Record<string, unknown>).campaignId
    if (typeof cid !== 'string') return { pass: true, rule: 'skan_maturity' }
    const campaign = await prisma.campaign.findFirst({
      where: { id: cid, orgId: ctx.orgId },
      select: { platform: true, objective: true, startDate: true },
    })
    if (!campaign) return { pass: true, rule: 'skan_maturity' }
    const channel = deriveSkanChannel(campaign.platform, campaign.objective)
    if (!channel) return { pass: true, rule: 'skan_maturity' }

    if (!campaign.startDate) {
      return {
        pass: false,
        rule: 'skan_maturity',
        reason: 'campaign startDate unknown — cannot verify SKAN maturity',
      }
    }
    const ageHours = (Date.now() - campaign.startDate.getTime()) / 3_600_000
    const ageDays = ageHours / 24

    if (ageHours < 72) {
      return {
        pass: false,
        rule: 'skan_maturity',
        reason: `campaign age ${ageHours.toFixed(1)}h < 72h — SKAN data untrusted`,
      }
    }

    if (ageDays <= LEARNING_PHASE_DAYS) {
      const budget = await prisma.budget.findFirst({
        where: { campaignId: cid, type: 'daily' },
        orderBy: { createdAt: 'desc' },
      })
      if (!budget) {
        return {
          pass: false,
          rule: 'skan_maturity',
          reason: 'no daily budget on record to verify learning-phase spend',
        }
      }
      const startOfToday = new Date()
      startOfToday.setUTCHours(0, 0, 0, 0)
      const todayReports = await prisma.report.findMany({
        where: { campaignId: cid, date: { gte: startOfToday } },
        select: { spend: true },
      })
      const spendToday = todayReports.reduce((s, r) => s + r.spend, 0)
      const multiple = budget.amount > 0 ? spendToday / budget.amount : 0
      if (multiple > LEARNING_PHASE_HARD_MULTIPLE) {
        return {
          pass: false,
          rule: 'skan_maturity',
          reason: `learning-phase spend ${multiple.toFixed(1)}x daily cap > ${LEARNING_PHASE_HARD_MULTIPLE}x`,
        }
      }
      return {
        pass: true,
        rule: 'skan_maturity',
        reason: `campaign in learning phase (day ${ageDays.toFixed(1)}) — proceed with caution`,
      }
    }

    return { pass: true, rule: 'skan_maturity' }
  },

  /**
   * Reject bid/budget increases whose channel's most recent CohortSnapshot
   * CAC exceeds the tier ceiling (firstMonthNet × SCALE_PAYBACK_MULTIPLE).
   * Not fail-closed: missing CohortSnapshot data is a "don't know", not a
   * violation, so it never blocks.
   */
  tier_cac_ceiling: async (ctx, config) => {
    if (ctx.step.tool !== 'adjust_bid' && ctx.step.tool !== 'adjust_daily_budget')
      return { pass: true, rule: 'tier_cac_ceiling' }
    if (!isSpendIncreaseTool(ctx.step)) return { pass: true, rule: 'tier_cac_ceiling' }
    const cfg = (config || {}) as { firstMonthNet?: number }
    const cid = (ctx.step.input as Record<string, unknown>).campaignId
    if (typeof cid !== 'string') return { pass: true, rule: 'tier_cac_ceiling' }
    const campaign = await prisma.campaign.findFirst({
      where: { id: cid, orgId: ctx.orgId },
      select: { platform: true, objective: true },
    })
    if (!campaign) return { pass: true, rule: 'tier_cac_ceiling' }
    const channel = deriveSkanChannel(campaign.platform, campaign.objective)
    if (!channel) return { pass: true, rule: 'tier_cac_ceiling' }

    const snapshot = await prisma.cohortSnapshot.findFirst({
      where: { orgId: ctx.orgId, channel },
      orderBy: { cohortDate: 'desc' },
    })
    if (!snapshot || snapshot.cac == null) {
      return {
        pass: true,
        rule: 'tier_cac_ceiling',
        reason: `no CohortSnapshot data for channel ${channel} — cannot verify CAC ceiling`,
      }
    }
    const firstMonthNet = cfg.firstMonthNet ?? FIRST_MONTH_NET_DEFAULT
    const ceiling = tierCacCeiling(firstMonthNet)
    if (!withinCacCeiling(snapshot.cac, ceiling)) {
      return {
        pass: false,
        rule: 'tier_cac_ceiling',
        reason: `CAC $${snapshot.cac.toFixed(2)} > tier ceiling $${ceiling.toFixed(2)} (channel ${channel})`,
        config,
      }
    }
    return { pass: true, rule: 'tier_cac_ceiling' }
  },
}

/**
 * True for tools that increase spend, used by pilot_budget_cap and
 * tier_cac_ceiling. Conservative: if a "previous" value isn't present to
 * compare against, treat it as an increase.
 */
function isSpendIncreaseTool(step: ProposedDecisionStep): boolean {
  const input = step.input as Record<string, unknown>
  switch (step.tool) {
    case 'adjust_daily_budget': {
      const next = Number(input.newDailyBudget)
      const prev = Number(input.previousDailyBudget)
      if (!Number.isFinite(next)) return false
      if (!Number.isFinite(prev)) return true
      return next > prev
    }
    case 'adjust_bid': {
      const next = Number(input.newBidUsd)
      const prev = Number(input.previousBidUsd)
      if (!Number.isFinite(next)) return false
      if (!Number.isFinite(prev)) return true
      return next > prev
    }
    case 'resume_campaign':
    case 'enable_smart_bidding':
    case 'clone_campaign':
      return true
    default:
      return false
  }
}

/**
 * Map Campaign(platform, objective) to the growth channel taxonomy's two
 * SKAN-attributed iOS channels. Returns null for anything else — those
 * campaigns aren't SKAN and this rule doesn't apply.
 */
function deriveSkanChannel(platform: string, objective: string | null): 'paid_meta_ios' | 'paid_tiktok_ios' | null {
  if (platform === 'meta' && objective === 'app_install') return 'paid_meta_ios'
  if (platform === 'tiktok' && objective === 'app_install') return 'paid_tiktok_ios'
  return null
}

type BuiltinDef = { rule: string; config: unknown; failClosed?: boolean }

// Audit High #9 — `failClosed: true` means an evaluator EXCEPTION blocks
// the step (safer for budget caps + active hours where silence = let
// money burn). Default fail-open is fine for cooldowns / signal-quality
// rules where missing data shouldn't lock the agent down.
const BUILTIN_DEFAULTS: BuiltinDef[] = [
  { rule: 'high_risk_requires_approval', config: {}, failClosed: true },
  { rule: 'llm_budget_cap', config: {}, failClosed: true },
  { rule: 'agent_active_hours', config: { startHourUtc: 0, endHourUtc: 24 }, failClosed: false },
  { rule: 'managed_only', config: {}, failClosed: true },
  { rule: 'cooldown', config: { hours: 4 } },
  { rule: 'pause_only_with_conversions', config: { minSpendThreshold: 50, minImpressionsForSignal: 2000 } },
  { rule: 'max_per_day', config: { max: 20 } },
  { rule: 'pilot_budget_cap', config: {}, failClosed: true },
  { rule: 'skan_maturity', config: {}, failClosed: true },
  { rule: 'tier_cac_ceiling', config: {}, failClosed: false },
]

const FAIL_CLOSED_RULES = new Set(
  BUILTIN_DEFAULTS.filter((d) => d.failClosed).map((d) => d.rule)
)

function evaluatorErrorResult(rule: string, err: unknown): GuardrailEvalResult {
  // Default fail-open. Override per rule via FAIL_CLOSED_RULES.
  const failClosed = FAIL_CLOSED_RULES.has(rule)
  return {
    pass: !failClosed,
    rule,
    reason: `evaluator error (${failClosed ? 'fail-closed' : 'fail-open'}): ${err instanceof Error ? err.message : String(err)}`,
  }
}

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
      results.push(evaluatorErrorResult(def.rule, err))
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
      results.push(evaluatorErrorResult(g.rule, err))
    }
  }

  return results
}

export function isBlocked(results: GuardrailEvalResult[]): boolean {
  return results.some((r) => !r.pass)
}
