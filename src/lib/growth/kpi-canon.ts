/**
 * Growth KPI Canon — the single source of truth for HOW every growth metric
 * is computed. UI, weekly reports, and the Agent's perceive() step must all
 * read numbers through these functions rather than recomputing inline.
 *
 * Why a canon: HakkoAI shipped a strict-vs-wide DAU discrepancy incident from
 * two teams defining "active" differently. We define each metric once, here,
 * with numerator / denominator / caveat spelled out in the doc comment.
 *
 * Design ref: docs/growth/00-cuddler-first-redesign.md §4.3
 * Pilot ref:  docs/growth/01-5k-pilot-plan.md §P5 (eCAC*)
 *
 * Conventions:
 * - Rates (0..1) return 0 when the denominator is 0 — matches Report defaults.
 * - Cost-per-X returns `null` when the denominator is 0. Cost per zero installs
 *   is undefined; callers render it as "—", never as 0 or Infinity.
 * - All money is USD. All functions are pure (no I/O, no Date.now()).
 */

/** Safe ratio in [0, ∞); returns 0 when denominator ≤ 0. */
function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return numerator / denominator
}

/** Cost-per-unit; returns null when there are no units (undefined, not 0). */
function costPer(cost: number, units: number): number | null {
  if (units <= 0) return null
  return cost / units
}

// ─────────────────────────────────────────────────────────────────────────
// Delivery metrics (numerator / denominator)
// ─────────────────────────────────────────────────────────────────────────

/** CTR = clicks / impressions. */
export function ctr(clicks: number, impressions: number): number {
  return rate(clicks, impressions)
}

/** CPC = spend / clicks (null if no clicks). */
export function cpc(spend: number, clicks: number): number | null {
  return costPer(spend, clicks)
}

/** CPI = spend / installs (null if no installs). Naive — see eCACStar. */
export function cpi(spend: number, installs: number): number | null {
  return costPer(spend, installs)
}

// ─────────────────────────────────────────────────────────────────────────
// eCAC* — the pilot's honest cost metric (01-5k-pilot-plan.md §P5)
// ─────────────────────────────────────────────────────────────────────────

/**
 * eCAC* = (media spend + media-subsidy COGS) / installs.
 *
 * Cuddler's video generation is a loss-leader (each scene nets −$0.5..$1,
 * unit_economics.md §2.1). A paid install that then generates free videos
 * costs more than its ad spend. Naive CPI hides this; eCAC* adds the
 * attributable subsidy COGS so channel comparison reflects true acquisition
 * cost. This is the P5 debate verdict — kill/scale decisions use eCAC*, not CPI.
 *
 * @param mediaSubsidyCost sum of loss-leader COGS attributable to this cohort
 *   (e.g. Σ free scenes generated × per-scene net loss). 0 if not applicable.
 * @returns cost per install, or null if no installs.
 */
export function eCACStar(params: {
  spend: number
  mediaSubsidyCost: number
  installs: number
}): number | null {
  const { spend, mediaSubsidyCost, installs } = params
  return costPer(spend + mediaSubsidyCost, installs)
}

/** Cost per paying user = spend / payingUsers (null if none). Used by Gate C. */
export function costPerPayingUser(spend: number, payingUsers: number): number | null {
  return costPer(spend, payingUsers)
}

/**
 * KOL effective CPI = cost / uplift installs. Uplift = installs above the
 * pre-publish baseline (hakko-kol-agent natural-uplift method). `costUsd`
 * includes cash + valued perks (e.g. a comped Ultra tier counted at price).
 */
export function effectiveCpi(costUsd: number, upliftInstalls: number): number | null {
  return costPer(costUsd, upliftInstalls)
}

// ─────────────────────────────────────────────────────────────────────────
// Funnel & retention (all GA4-aligned; see Cuddler analytics_canon.md)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Activation rate = activated / installs. Cuddler defines activation as the
 * first completed `chat.started` (first-chat), NOT signup. PRD target ≥55%.
 */
export function activationRate(activated: number, installs: number): number {
  return rate(activated, installs)
}

/**
 * Retention rate = retained / cohortSize. Retained is measured on the calendar
 * day cohortDate + N (D1 → +1, D7 → +7), GA4 definition — a returning-session
 * count, not a rolling window. PRD targets: D1 ≥30%, D7 ≥18%.
 */
export function retentionRate(retained: number, cohortSize: number): number {
  return rate(retained, cohortSize)
}

/** Subscription rate = subscribers / installs. PRD target ≥2% within 90d. */
export function subscriptionRate(subscribers: number, installs: number): number {
  return rate(subscribers, installs)
}

/** Trial→paid = paidConversions / trialStarts. trial ≠ paid — never conflate. */
export function trialToPaidRate(paidConversions: number, trialStarts: number): number {
  return rate(paidConversions, trialStarts)
}

// ─────────────────────────────────────────────────────────────────────────
// LTV — realized vs projected kept strictly separate (Subscribe_Analysis)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Realized LTV to date = cumulative net revenue / installs. Net revenue is
 * post-fee (RevenueCat / Stripe net). This is a FACT, not a projection.
 */
export function realizedLtv(cumulativeNetRevenue: number, installs: number): number {
  return rate(cumulativeNetRevenue, installs)
}

/**
 * Projected subscriber LTV via geometric retention decay — an ESTIMATE.
 *
 * LTV ≈ Σ_{m=0..H-1} monthlyNetRevenue × monthlyRetention^m
 *
 * Assumes a constant monthly retention (a simplification the pilot doc flags:
 * $5K samples cannot fit a real curve). Use for directional ranking only.
 *
 * @param monthlyRetention subscriber month-over-month retention in [0,1)
 * @param horizonMonths cap on the projection window (avoids infinite tail)
 */
export function projectSubscriberLtv(params: {
  monthlyNetRevenue: number
  monthlyRetention: number
  horizonMonths: number
}): number {
  const { monthlyNetRevenue, monthlyRetention, horizonMonths } = params
  if (monthlyNetRevenue <= 0 || horizonMonths <= 0) return 0
  const r = Math.min(Math.max(monthlyRetention, 0), 0.999) // clamp; r<1 for convergence
  let ltv = 0
  for (let m = 0; m < Math.floor(horizonMonths); m++) {
    ltv += monthlyNetRevenue * Math.pow(r, m)
  }
  return ltv
}

// ─────────────────────────────────────────────────────────────────────────
// Virality
// ─────────────────────────────────────────────────────────────────────────

export type Confidence = 'measured' | 'estimated'

/**
 * K-factor = deeplink-attributed installs / active users. Until Cuddler's
 * deeplink→install attribution ships (APPLE_TEAM_ID, its own P0), this is an
 * ESTIMATE — the caller must surface the confidence flag, never present an
 * estimated K-factor as measured.
 */
export function kFactor(
  deeplinkInstalls: number,
  activeUsers: number,
  attributionReady: boolean,
): { value: number; confidence: Confidence } {
  return {
    value: rate(deeplinkInstalls, activeUsers),
    confidence: attributionReady ? 'measured' : 'estimated',
  }
}
