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
  it('S2S-only org (no legacy credential, live adjust events) → Adjust is authority', () => {
    // The recommended setup wires only the callback route — the legacy
    // Report-API credential must not be a precondition for authority.
    expect(
      resolveInstallAuthority({ hasAdjustAuth: false, adjustInstallCount: 40, ga4InstallCount: 50 }),
    ).toEqual({ authority: 'adjust', fallback: false })
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
