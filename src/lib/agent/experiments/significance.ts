/**
 * Two-proportion z-test for A/B experiments.
 *
 * Used by ExperimentArm conclusion logic: each arm provides
 *   { successes: number; trials: number }
 * (e.g. successes = clicks, trials = impressions for CTR; or
 * successes = conversions, trials = clicks for CVR).
 *
 * Returns the z-statistic and a one-sided p-value approximation. We
 * deliberately stay simple — no t-test, no Bayesian. Phase 15 ships this;
 * upgrades land later if we see false-positive trouble.
 */

export type ArmStats = { successes: number; trials: number }

export type SignificanceResult = {
  z: number
  pOneSided: number
  pTwoSided: number
  liftPct: number
  significant: boolean
  liftPctConfidenceInterval: [number, number]
}

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation, accurate to ~1.5e-7
  const sign = Math.sign(x)
  x = Math.abs(x)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return sign * y
}

function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/**
 * compareProportions — control vs variant. Significant iff p < alpha (default 0.05).
 */
export function compareProportions(
  control: ArmStats,
  variant: ArmStats,
  opts: { alpha?: number } = {}
): SignificanceResult {
  const alpha = opts.alpha ?? 0.05
  if (control.trials === 0 || variant.trials === 0) {
    return {
      z: 0,
      pOneSided: 1,
      pTwoSided: 1,
      liftPct: 0,
      significant: false,
      liftPctConfidenceInterval: [0, 0],
    }
  }
  const p1 = control.successes / control.trials
  const p2 = variant.successes / variant.trials
  const pPool =
    (control.successes + variant.successes) / (control.trials + variant.trials)
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / control.trials + 1 / variant.trials))
  const z = se === 0 ? 0 : (p2 - p1) / se
  const pOneSided = 1 - normCdf(Math.abs(z))
  const pTwoSided = 2 * pOneSided
  const liftPct = p1 === 0 ? 0 : ((p2 - p1) / p1) * 100
  // 95% CI for absolute difference, then expressed as % of control rate.
  const seDiff = Math.sqrt(
    (p1 * (1 - p1)) / control.trials + (p2 * (1 - p2)) / variant.trials
  )
  const z95 = 1.96
  const diffLower = p2 - p1 - z95 * seDiff
  const diffUpper = p2 - p1 + z95 * seDiff
  const ciLower = p1 === 0 ? 0 : (diffLower / p1) * 100
  const ciUpper = p1 === 0 ? 0 : (diffUpper / p1) * 100
  return {
    z,
    pOneSided,
    pTwoSided,
    liftPct,
    significant: pTwoSided < alpha,
    liftPctConfidenceInterval: [ciLower, ciUpper],
  }
}
