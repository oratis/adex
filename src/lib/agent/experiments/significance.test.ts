import { describe, it, expect } from 'vitest'
import { compareProportions } from './significance'

describe('compareProportions', () => {
  it('returns non-significant for identical proportions', () => {
    const r = compareProportions(
      { successes: 100, trials: 1000 },
      { successes: 100, trials: 1000 }
    )
    expect(r.significant).toBe(false)
    expect(r.liftPct).toBe(0)
  })

  it('detects a clear positive lift', () => {
    const r = compareProportions(
      { successes: 100, trials: 1000 },   // 10%
      { successes: 200, trials: 1000 }    // 20%
    )
    expect(r.significant).toBe(true)
    expect(r.liftPct).toBeGreaterThan(0)
    expect(r.z).toBeGreaterThan(0)
  })

  it('detects a clear negative lift', () => {
    const r = compareProportions(
      { successes: 200, trials: 1000 },
      { successes: 100, trials: 1000 }
    )
    expect(r.significant).toBe(true)
    expect(r.liftPct).toBeLessThan(0)
    expect(r.z).toBeLessThan(0)
  })

  it('does not call tiny differences significant', () => {
    const r = compareProportions(
      { successes: 100, trials: 1000 },   // 10.0%
      { successes: 105, trials: 1000 }    // 10.5%
    )
    expect(r.significant).toBe(false)
  })

  it('handles zero trials gracefully', () => {
    const r = compareProportions(
      { successes: 0, trials: 0 },
      { successes: 5, trials: 100 }
    )
    expect(r.significant).toBe(false)
    expect(r.pTwoSided).toBe(1)
  })

  it('returns 95% CI bracketing the lift', () => {
    const r = compareProportions(
      { successes: 100, trials: 1000 },
      { successes: 200, trials: 1000 }
    )
    expect(r.liftPctConfidenceInterval[0]).toBeLessThan(r.liftPct)
    expect(r.liftPctConfidenceInterval[1]).toBeGreaterThan(r.liftPct)
  })
})
