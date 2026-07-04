/**
 * $5K pilot kill/scale gates — the P5 debate verdict as code.
 *
 * The pilot answers "which channel is most worth a bigger test", NOT "which is
 * profitable" ($5K yields single-digit paying users — no profitability claim is
 * statistically possible). So gates are sequential by cumulative channel spend:
 *
 *   Gate A ($400)  mechanical floor — proxy metrics may KILL only.
 *   Gate B ($800)  quality confirm — needs real payment signal or halve.
 *   Gate C ($1,250) scale release  — directional green light, not proof.
 *   Global ($2,500) mixed-eCAC* circuit breaker — freeze all scaling.
 *
 * Discipline (payment_signal_gate guardrail): proxy metrics can only cut/hold;
 * any budget INCREASE requires real RevenueCat paying users. Thresholds are
 * anchored to Cuddler PRD §1 targets, not invented.
 *
 * Ref: docs/growth/01-5k-pilot-plan.md §P5
 */

import { eCACStar, costPerPayingUser, cpi as cpiOf } from './kpi-canon'

// ── Spend milestones (USD, per channel unless noted) ──────────────────────
export const GATE_A_SPEND = 400
export const GATE_B_SPEND = 800
export const GATE_C_SPEND = 1250
export const GLOBAL_KILL_SPEND = 2500 // cumulative across all channels

// ── Thresholds (anchored to Cuddler PRD §1 / unit_economics.md) ───────────
export const MIN_INSTALLS_FLOOR = 50 // Gate A: too few installs → can't judge
export const MAX_CPI = 8 // Gate A: naive CPI ceiling
export const MIN_ACTIVATION_RATE = 0.4 // Gate A: first-chat completion floor
export const GATE_B_MIN_PAYING = 3 // Gate B: real payment signal must appear
export const MIN_D7 = 0.18 // Gate B: PRD D7 target as quality floor
export const GATE_C_MIN_PAYING = 5 // Gate C: min paying users to consider scale
export const SCALE_PAYBACK_MULTIPLE = 5 // Gate C: cost-per-paying ≤ N× first-month net
export const FIRST_MONTH_NET_DEFAULT = 8.5 // Pro web net ≈ $9.10; conservative $8.5
export const MAX_MIXED_ECAC = 8 // Global: mixed eCAC* circuit breaker

export type GateDecision =
  | 'kill' // stop the channel
  | 'halve' // cut budget in half
  | 'continue' // keep running unchanged
  | 'scale' // release reserve budget to this channel
  | 'freeze_scaling' // global: no channel may scale
  | 'insufficient_data' // not enough spend to evaluate this gate yet

export interface ChannelMetrics {
  /** channel is app-install on a SKAN-only iOS placement (data <72h untrusted) */
  skanImmature?: boolean
  spend: number
  installs: number
  activationRate: number // 0..1 (first-chat completion)
  d7: number // 0..1
  mediaSubsidyCost: number // loss-leader COGS attributable to this cohort
  payingUsers: number // real RevenueCat-confirmed paying users
}

export interface GateResult {
  gate: 'A' | 'B' | 'C' | 'global'
  decision: GateDecision
  reasons: string[]
}

/** Gate A — mechanical floor. Proxy metrics; KILL only, never scale. */
export function evaluateGateA(m: ChannelMetrics): GateResult {
  if (m.spend < GATE_A_SPEND) {
    return { gate: 'A', decision: 'insufficient_data', reasons: [`spend $${m.spend} < $${GATE_A_SPEND}`] }
  }
  const reasons: string[] = []
  const naiveCpi = cpiOf(m.spend, m.installs)
  if (m.installs < MIN_INSTALLS_FLOOR) reasons.push(`installs ${m.installs} < ${MIN_INSTALLS_FLOOR}`)
  if (naiveCpi !== null && naiveCpi > MAX_CPI) reasons.push(`CPI $${naiveCpi.toFixed(2)} > $${MAX_CPI}`)
  if (m.activationRate < MIN_ACTIVATION_RATE)
    reasons.push(`activation ${(m.activationRate * 100).toFixed(0)}% < ${MIN_ACTIVATION_RATE * 100}%`)
  if (reasons.length > 0) return { gate: 'A', decision: 'kill', reasons }
  return { gate: 'A', decision: 'continue', reasons: ['passed mechanical floor'] }
}

/** Gate B — quality confirmation. Real payment signal required or halve. */
export function evaluateGateB(m: ChannelMetrics): GateResult {
  if (m.spend < GATE_B_SPEND) {
    return { gate: 'B', decision: 'insufficient_data', reasons: [`spend $${m.spend} < $${GATE_B_SPEND}`] }
  }
  const reasons: string[] = []
  const ecac = eCACStar({ spend: m.spend, mediaSubsidyCost: m.mediaSubsidyCost, installs: m.installs })
  if (ecac !== null) reasons.push(`eCAC* $${ecac.toFixed(2)}`)
  if (m.payingUsers < GATE_B_MIN_PAYING) {
    reasons.push(`paying users ${m.payingUsers} < ${GATE_B_MIN_PAYING} (no real payment signal)`)
    return { gate: 'B', decision: 'halve', reasons }
  }
  if (m.d7 < MIN_D7) {
    reasons.push(`D7 ${(m.d7 * 100).toFixed(0)}% < ${MIN_D7 * 100}%`)
    return { gate: 'B', decision: 'halve', reasons }
  }
  reasons.push(`paying ${m.payingUsers} ≥ ${GATE_B_MIN_PAYING}, D7 ok`)
  return { gate: 'B', decision: 'continue', reasons }
}

/**
 * Gate C — scale release. Directional green light, NOT a profitability proof.
 * Requires the deterministic payment-based checks; the optional Bayesian
 * concern (P(conv<1%) high vs organic prior) is supplied by the caller — when
 * true it blocks scaling even if the cost check passes.
 */
export function evaluateGateC(
  m: ChannelMetrics,
  opts: { firstMonthNet?: number; priorConversionConcern?: boolean } = {},
): GateResult {
  if (m.spend < GATE_C_SPEND) {
    return { gate: 'C', decision: 'insufficient_data', reasons: [`spend $${m.spend} < $${GATE_C_SPEND}`] }
  }
  const firstMonthNet = opts.firstMonthNet ?? FIRST_MONTH_NET_DEFAULT
  const ceiling = SCALE_PAYBACK_MULTIPLE * firstMonthNet
  const reasons: string[] = []
  const cpp = costPerPayingUser(m.spend, m.payingUsers)

  if (m.payingUsers < GATE_C_MIN_PAYING) {
    reasons.push(`paying users ${m.payingUsers} < ${GATE_C_MIN_PAYING}`)
    return { gate: 'C', decision: 'continue', reasons }
  }
  if (cpp === null || cpp > ceiling) {
    reasons.push(`cost/paying ${cpp === null ? '—' : '$' + cpp.toFixed(2)} > $${ceiling.toFixed(2)} ceiling`)
    return { gate: 'C', decision: 'continue', reasons }
  }
  if (opts.priorConversionConcern) {
    reasons.push('P(conversion<1%) high vs organic prior — hold scaling')
    return { gate: 'C', decision: 'continue', reasons }
  }
  reasons.push(`cost/paying $${cpp.toFixed(2)} ≤ $${ceiling.toFixed(2)}, paying ${m.payingUsers} ≥ ${GATE_C_MIN_PAYING}`)
  return { gate: 'C', decision: 'scale', reasons }
}

/**
 * Global circuit breaker — once cumulative pilot spend hits $2,500, if the
 * blended eCAC* across channels exceeds the ceiling, freeze ALL scaling
 * (channels may still run at current budget; only budget increases stop).
 */
export function evaluateGlobalKill(params: {
  cumulativeSpend: number
  totalMediaSubsidyCost: number
  totalInstalls: number
}): GateResult {
  const { cumulativeSpend, totalMediaSubsidyCost, totalInstalls } = params
  if (cumulativeSpend < GLOBAL_KILL_SPEND) {
    return { gate: 'global', decision: 'insufficient_data', reasons: [`cumulative $${cumulativeSpend} < $${GLOBAL_KILL_SPEND}`] }
  }
  const blended = eCACStar({ spend: cumulativeSpend, mediaSubsidyCost: totalMediaSubsidyCost, installs: totalInstalls })
  if (blended !== null && blended > MAX_MIXED_ECAC) {
    return { gate: 'global', decision: 'freeze_scaling', reasons: [`blended eCAC* $${blended.toFixed(2)} > $${MAX_MIXED_ECAC}`] }
  }
  return { gate: 'global', decision: 'continue', reasons: [`blended eCAC* ok`] }
}

/**
 * Evaluate a channel at its current spend: returns the highest-milestone gate
 * whose spend threshold is met. A SKAN-immature iOS channel is never auto-acted
 * on (skan_maturity guardrail) — it returns insufficient_data regardless.
 */
export function evaluateChannel(
  m: ChannelMetrics,
  opts?: { firstMonthNet?: number; priorConversionConcern?: boolean },
): GateResult {
  if (m.skanImmature) {
    return { gate: 'A', decision: 'insufficient_data', reasons: ['SKAN data <72h — auto-action suppressed'] }
  }
  if (m.spend >= GATE_C_SPEND) {
    const c = evaluateGateC(m, opts)
    if (c.decision !== 'insufficient_data') return c
  }
  if (m.spend >= GATE_B_SPEND) {
    const b = evaluateGateB(m)
    if (b.decision !== 'insufficient_data') return b
  }
  return evaluateGateA(m)
}
