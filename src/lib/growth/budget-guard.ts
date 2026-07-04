/**
 * Budget-guard — the P6 debate verdict as code (pure). Three layers:
 *   1. platform-native account spending limit (set outside Adex; primary)
 *   2. Adex pacing prediction + alerts  ← evaluatePilotBudget
 *   3. one-directional "down" auto-action on egregious breach ← evaluateChannelBreach
 *
 * Discipline: automation may only cut/pause, never raise. Learning-phase and
 * SKAN-immature channels are protected from auto-pause on stale/uncertain data.
 *
 * Ref: docs/growth/01-5k-pilot-plan.md §P6
 */

// ── Pilot cap (global) ────────────────────────────────────────────────────
export const PILOT_CAP_TOTAL = 5000
export const PILOT_WARN_PCT = 0.8
export const PILOT_AUTOPAUSE_PCT = 0.95

// ── Channel breach (per-channel, per-day) ─────────────────────────────────
export const CHANNEL_BREACH_DAILY_MULTIPLE = 1.5 // >150% of daily cap
export const CPI_BREACH_MULTIPLE = 3 // CPI > 3× target
export const CPI_BREACH_MIN_N = 30 // ...with at least this many installs
export const LEARNING_PHASE_DAYS = 7
export const LEARNING_PHASE_HARD_MULTIPLE = 2.0 // during learning, only >200% auto-pauses

// ── Tier CAC ceiling ──────────────────────────────────────────────────────
export const SCALE_PAYBACK_MULTIPLE = 5 // eCAC* ≤ 5× first-month net (per paying user)

export type BudgetAction = 'ok' | 'warn' | 'auto_pause'

export interface GuardResult {
  action: BudgetAction
  reasons: string[]
}

/** Layer 2 — global pilot pacing. Auto-pause API-reachable channels at 95%. */
export function evaluatePilotBudget(params: { cumulativeSpend: number; capTotal?: number }): GuardResult & { pct: number } {
  const cap = params.capTotal ?? PILOT_CAP_TOTAL
  const pct = cap > 0 ? params.cumulativeSpend / cap : 0
  if (pct >= PILOT_AUTOPAUSE_PCT) {
    return { action: 'auto_pause', pct, reasons: [`spend ${(pct * 100).toFixed(0)}% ≥ ${PILOT_AUTOPAUSE_PCT * 100}% cap → pause API-reachable channels`] }
  }
  if (pct >= PILOT_WARN_PCT) {
    return { action: 'warn', pct, reasons: [`spend ${(pct * 100).toFixed(0)}% ≥ ${PILOT_WARN_PCT * 100}% cap`] }
  }
  return { action: 'ok', pct, reasons: [] }
}

/**
 * Layer 3 — one-directional channel breach. Returns auto_pause ONLY on an
 * egregious, trustworthy breach; SKAN-immature and learning-phase channels are
 * protected (they can warn, not auto-pause, except a >200% learning breach).
 */
export function evaluateChannelBreach(params: {
  spendToday: number
  dailyCap: number
  cpi: number | null
  targetCpi: number | null
  installs: number
  ageDays: number
  skanImmature?: boolean
}): GuardResult {
  const reasons: string[] = []
  const overDaily = params.dailyCap > 0 ? params.spendToday / params.dailyCap : 0

  // skan_maturity: never auto-act on SKAN-immature data.
  if (params.skanImmature) {
    if (overDaily >= CHANNEL_BREACH_DAILY_MULTIPLE) reasons.push(`spend ${(overDaily * 100).toFixed(0)}% of cap (SKAN — alert only)`)
    return { action: reasons.length ? 'warn' : 'ok', reasons }
  }

  const cpiBreach =
    params.cpi !== null &&
    params.targetCpi !== null &&
    params.targetCpi > 0 &&
    params.cpi > CPI_BREACH_MULTIPLE * params.targetCpi &&
    params.installs >= CPI_BREACH_MIN_N

  // Learning phase: protect from auto-pause unless spend is truly runaway.
  if (params.ageDays < LEARNING_PHASE_DAYS) {
    if (overDaily > LEARNING_PHASE_HARD_MULTIPLE) {
      return { action: 'auto_pause', reasons: [`learning-phase runaway: spend ${(overDaily * 100).toFixed(0)}% > ${LEARNING_PHASE_HARD_MULTIPLE * 100}% cap`] }
    }
    if (overDaily >= CHANNEL_BREACH_DAILY_MULTIPLE || cpiBreach) reasons.push('breach during learning phase — alert only (protect learning)')
    return { action: reasons.length ? 'warn' : 'ok', reasons }
  }

  if (overDaily >= CHANNEL_BREACH_DAILY_MULTIPLE) reasons.push(`spend ${(overDaily * 100).toFixed(0)}% ≥ ${CHANNEL_BREACH_DAILY_MULTIPLE * 100}% of daily cap`)
  if (cpiBreach) reasons.push(`CPI $${params.cpi!.toFixed(2)} > ${CPI_BREACH_MULTIPLE}× target (n=${params.installs})`)
  return { action: reasons.length ? 'auto_pause' : 'ok', reasons }
}

/** tier_cac_ceiling: max acceptable eCAC* per paying user. */
export function tierCacCeiling(firstMonthNet: number, paybackMultiple = SCALE_PAYBACK_MULTIPLE): number {
  return firstMonthNet * paybackMultiple
}

export function withinCacCeiling(ecac: number | null, ceiling: number): boolean {
  return ecac !== null && ecac <= ceiling
}
