import { describe, it, expect } from 'vitest'
import {
  ctr,
  cpc,
  cpi,
  eCACStar,
  costPerPayingUser,
  effectiveCpi,
  activationRate,
  retentionRate,
  subscriptionRate,
  trialToPaidRate,
  realizedLtv,
  projectSubscriberLtv,
  kFactor,
  resolveInstallAuthority,
  isMatureForRetentionWindow,
  costPerSignup,
  roi,
  arpu,
  arppu,
  aggregateCohortWindow,
  computeFunnelMetrics,
} from './kpi-canon'

describe('rate metrics', () => {
  it('ctr = clicks / impressions', () => {
    expect(ctr(50, 1000)).toBeCloseTo(0.05)
  })
  it('returns 0 (not NaN) on zero denominator', () => {
    expect(ctr(5, 0)).toBe(0)
    expect(activationRate(3, 0)).toBe(0)
    expect(retentionRate(1, 0)).toBe(0)
    expect(subscriptionRate(1, 0)).toBe(0)
    expect(trialToPaidRate(1, 0)).toBe(0)
  })
})

describe('cost-per-X returns null on zero units (undefined, not 0)', () => {
  it('cpc / cpi null when no clicks / installs', () => {
    expect(cpc(100, 0)).toBeNull()
    expect(cpi(100, 0)).toBeNull()
  })
  it('cpi computes when installs > 0', () => {
    expect(cpi(300, 100)).toBeCloseTo(3)
  })
})

describe('eCACStar — the pilot honesty correction', () => {
  it('adds media-subsidy COGS on top of naive CPI', () => {
    // 100 installs, $300 spend → naive CPI $3; + $200 video loss → eCAC* $5
    expect(eCACStar({ spend: 300, mediaSubsidyCost: 200, installs: 100 })).toBeCloseTo(5)
  })
  it('equals CPI when no subsidy cost', () => {
    expect(eCACStar({ spend: 300, mediaSubsidyCost: 0, installs: 100 })).toBeCloseTo(3)
  })
  it('null when no installs', () => {
    expect(eCACStar({ spend: 300, mediaSubsidyCost: 200, installs: 0 })).toBeNull()
  })
})

describe('paying-user & KOL cost', () => {
  it('costPerPayingUser', () => {
    expect(costPerPayingUser(500, 10)).toBeCloseTo(50)
    expect(costPerPayingUser(500, 0)).toBeNull()
  })
  it('effectiveCpi uses uplift installs', () => {
    expect(effectiveCpi(200, 40)).toBeCloseTo(5)
    expect(effectiveCpi(200, 0)).toBeNull()
  })
})

describe('LTV — realized vs projected kept separate', () => {
  it('realizedLtv is a fact: cumulative net / installs', () => {
    expect(realizedLtv(170, 1000)).toBeCloseTo(0.17)
  })
  it('projectSubscriberLtv sums a geometric retention decay', () => {
    // $10/mo, 50% retention, 3 months → 10 + 5 + 2.5 = 17.5
    expect(projectSubscriberLtv({ monthlyNetRevenue: 10, monthlyRetention: 0.5, horizonMonths: 3 })).toBeCloseTo(17.5)
  })
  it('projection is 0 for non-positive revenue or horizon', () => {
    expect(projectSubscriberLtv({ monthlyNetRevenue: 0, monthlyRetention: 0.5, horizonMonths: 3 })).toBe(0)
    expect(projectSubscriberLtv({ monthlyNetRevenue: 10, monthlyRetention: 0.5, horizonMonths: 0 })).toBe(0)
  })
  it('clamps retention < 1 so it always converges', () => {
    // r would be 1.0 → clamped to 0.999, 2 months ≈ 10 + 9.99
    const v = projectSubscriberLtv({ monthlyNetRevenue: 10, monthlyRetention: 1, horizonMonths: 2 })
    expect(v).toBeGreaterThan(19)
    expect(v).toBeLessThan(20)
  })
})

describe('kFactor carries a confidence flag', () => {
  it('flags estimated until attribution ready', () => {
    const est = kFactor(30, 300, false)
    expect(est.value).toBeCloseTo(0.1)
    expect(est.confidence).toBe('estimated')
  })
  it('flags measured once attribution ready', () => {
    expect(kFactor(30, 300, true).confidence).toBe('measured')
  })
})

describe('resolveInstallAuthority — decision A + anti-zeroing guard', () => {
  it('no Adjust auth → GA4 is authority', () => {
    expect(
      resolveInstallAuthority({ hasAdjustAuth: false, adjustInstallCount: 0, ga4InstallCount: 50 }),
    ).toEqual({ authority: 'ga4', fallback: false })
  })
  it('Adjust auth configured and reporting installs → Adjust is authority', () => {
    expect(
      resolveInstallAuthority({ hasAdjustAuth: true, adjustInstallCount: 40, ga4InstallCount: 50 }),
    ).toEqual({ authority: 'adjust', fallback: false })
  })
  it('anti-zeroing: Adjust configured but 0 installs in window while GA4 has signal → falls back to GA4 with a warning', () => {
    const r = resolveInstallAuthority({ hasAdjustAuth: true, adjustInstallCount: 0, ga4InstallCount: 30 })
    expect(r.authority).toBe('ga4')
    expect(r.fallback).toBe(true)
    expect(r.warning).toMatch(/adjust/i)
  })
  it('does not fall back when both sources are legitimately 0', () => {
    expect(
      resolveInstallAuthority({ hasAdjustAuth: true, adjustInstallCount: 0, ga4InstallCount: 0 }),
    ).toEqual({ authority: 'adjust', fallback: false })
  })
  it('does not fall back when the authority source has installs, even if lower than the other', () => {
    expect(
      resolveInstallAuthority({ hasAdjustAuth: true, adjustInstallCount: 5, ga4InstallCount: 100 }),
    ).toEqual({ authority: 'adjust', fallback: false })
  })
})

describe('isMatureForRetentionWindow — bi §6 D7-dilution gate', () => {
  it('is mature once cohortDate + N has passed', () => {
    expect(isMatureForRetentionWindow('2026-07-01', 7, new Date('2026-07-08T00:00:00.000Z'))).toBe(true)
    expect(isMatureForRetentionWindow('2026-07-01', 7, new Date('2026-07-08T00:00:00.001Z'))).toBe(true)
  })
  it('is immature just before cohortDate + N', () => {
    expect(isMatureForRetentionWindow('2026-07-01', 7, new Date('2026-07-07T23:59:59.999Z'))).toBe(false)
  })
  it('D1 matures a day earlier than D7', () => {
    const now = new Date('2026-07-02T00:00:00.000Z')
    expect(isMatureForRetentionWindow('2026-07-01', 1, now)).toBe(true)
    expect(isMatureForRetentionWindow('2026-07-01', 7, now)).toBe(false)
  })
})

describe('bi §6 summary metrics', () => {
  it('costPerSignup = spend / signups, null when no signups', () => {
    expect(costPerSignup(100, 20)).toBeCloseTo(5)
    expect(costPerSignup(100, 0)).toBeNull()
  })
  it('roi = revenue / spend, null when spend is 0', () => {
    expect(roi(150, 100)).toBeCloseTo(1.5)
    expect(roi(150, 0)).toBeNull()
  })
  it('arpu / arppu return 0 (not NaN) on zero denominator', () => {
    expect(arpu(100, 0)).toBe(0)
    expect(arppu(100, 0)).toBe(0)
    expect(arpu(100, 50)).toBeCloseTo(2)
    expect(arppu(100, 10)).toBeCloseTo(10)
  })
})

describe('aggregateCohortWindow — bi §7 shared cohort folding', () => {
  const now = new Date('2026-07-10T00:00:00.000Z')

  it('sums cohortSize/signups/revenue across rows regardless of maturity', () => {
    const agg = aggregateCohortWindow(
      [
        { cohortDate: '2026-07-01', installs: 5, signups: 5, d1Retained: 2, d7Retained: 1, revenueD0: 10, revenueD7: 20 },
        { cohortDate: '2026-07-09', installs: 3, signups: 0, d1Retained: 1, d7Retained: 0, revenueD0: 5, revenueD7: 5 },
      ],
      now,
    )
    expect(agg.cohortSize).toBe(13)
    expect(agg.signups).toBe(5)
    expect(agg.revenueD0).toBe(15)
    expect(agg.revenueD7).toBe(25)
  })

  it('gates d1/d7 numerator+denominator by maturity — immature cohorts excluded from both', () => {
    // 2026-07-09 + 1 day = 2026-07-10 (mature as of `now`); +7 days = 2026-07-16 (immature)
    const agg = aggregateCohortWindow(
      [{ cohortDate: '2026-07-09', installs: 10, signups: 0, d1Retained: 4, d7Retained: 9, revenueD0: 0, revenueD7: 0 }],
      now,
    )
    expect(agg.d1).toBe(4)
    expect(agg.d1Base).toBe(10)
    expect(agg.d7).toBe(0)
    expect(agg.d7Base).toBe(0)
  })

  it('empty input yields an all-zero aggregate', () => {
    expect(aggregateCohortWindow([], now)).toEqual({
      cohortSize: 0,
      signups: 0,
      d1: 0,
      d1Base: 0,
      d7: 0,
      d7Base: 0,
      revenueD0: 0,
      revenueD7: 0,
    })
  })
})

describe('computeFunnelMetrics — bi §7 shared funnel formula', () => {
  it('derives costPerSignup/d1Rate/d7Rate/d0Roi/d7Roi from a window aggregate + spend', () => {
    const result = computeFunnelMetrics({
      spend: 100,
      signups: 20,
      d1Retained: 4,
      d1Base: 20,
      d7Retained: 2,
      d7Base: 20,
      revenueD0: 50,
      revenueD7: 150,
    })
    expect(result.costPerSignup).toBeCloseTo(5)
    expect(result.d1Rate).toBeCloseTo(0.2)
    expect(result.d7Rate).toBeCloseTo(0.1)
    expect(result.d0Roi).toBeCloseTo(0.5)
    expect(result.d7Roi).toBeCloseTo(1.5)
  })

  it('costPerSignup and roi are null on zero spend/signups; rates are 0 not NaN', () => {
    const result = computeFunnelMetrics({
      spend: 0,
      signups: 0,
      d1Retained: 0,
      d1Base: 0,
      d7Retained: 0,
      d7Base: 0,
      revenueD0: 0,
      revenueD7: 0,
    })
    expect(result.costPerSignup).toBeNull()
    expect(result.d0Roi).toBeNull()
    expect(result.d7Roi).toBeNull()
    expect(result.d1Rate).toBe(0)
    expect(result.d7Rate).toBe(0)
  })
})
