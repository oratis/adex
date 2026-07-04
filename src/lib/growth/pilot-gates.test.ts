import { describe, it, expect } from 'vitest'
import {
  evaluateGateA,
  evaluateGateB,
  evaluateGateC,
  evaluateGlobalKill,
  evaluateChannel,
  type ChannelMetrics,
} from './pilot-gates'

/** A healthy baseline channel; individual tests perturb one dimension. */
function base(overrides: Partial<ChannelMetrics> = {}): ChannelMetrics {
  return {
    spend: 1300,
    installs: 400,
    activationRate: 0.55,
    d7: 0.2,
    mediaSubsidyCost: 200,
    payingUsers: 6,
    ...overrides,
  }
}

describe('Gate A — mechanical floor (kill only)', () => {
  it('insufficient data below $400', () => {
    expect(evaluateGateA(base({ spend: 300 })).decision).toBe('insufficient_data')
  })
  it('kills on too few installs', () => {
    const r = evaluateGateA(base({ spend: 400, installs: 40 }))
    expect(r.decision).toBe('kill')
    expect(r.reasons.join()).toContain('installs')
  })
  it('kills on CPI > $8', () => {
    // $500 / 50 installs = $10 CPI
    expect(evaluateGateA(base({ spend: 500, installs: 50, activationRate: 0.6 })).decision).toBe('kill')
  })
  it('kills on activation < 40%', () => {
    expect(evaluateGateA(base({ spend: 400, installs: 200, activationRate: 0.3 })).decision).toBe('kill')
  })
  it('continues when floor cleared', () => {
    expect(evaluateGateA(base({ spend: 400, installs: 200, activationRate: 0.55 })).decision).toBe('continue')
  })
})

describe('Gate B — needs real payment signal or halve', () => {
  it('halves when fewer than 3 paying users (no payment signal)', () => {
    const r = evaluateGateB(base({ spend: 800, payingUsers: 1 }))
    expect(r.decision).toBe('halve')
    expect(r.reasons.join()).toContain('payment signal')
  })
  it('halves when D7 below PRD floor', () => {
    expect(evaluateGateB(base({ spend: 800, payingUsers: 4, d7: 0.1 })).decision).toBe('halve')
  })
  it('continues with payment signal and healthy D7', () => {
    expect(evaluateGateB(base({ spend: 800, payingUsers: 4, d7: 0.2 })).decision).toBe('continue')
  })
})

describe('Gate C — scale release is directional, payment-gated', () => {
  it('does not scale below 5 paying users', () => {
    expect(evaluateGateC(base({ payingUsers: 4 })).decision).toBe('continue')
  })
  it('does not scale when cost/paying exceeds 5× first-month net', () => {
    // 3 paying... use 5 paying but huge spend → cost/paying high
    const r = evaluateGateC(base({ spend: 1300, payingUsers: 5 })) // 1300/5 = $260 > $42.5
    expect(r.decision).toBe('continue')
    expect(r.reasons.join()).toContain('ceiling')
  })
  it('scales when paying ≥5 and cost/paying within ceiling', () => {
    // 40 paying → 1300/40 = $32.5 ≤ $42.5
    expect(evaluateGateC(base({ spend: 1300, payingUsers: 40 })).decision).toBe('scale')
  })
  it('holds scaling when caller flags a Bayesian conversion concern', () => {
    const r = evaluateGateC(base({ spend: 1300, payingUsers: 40 }), { priorConversionConcern: true })
    expect(r.decision).toBe('continue')
  })
})

describe('global circuit breaker', () => {
  it('freezes scaling when blended eCAC* exceeds ceiling', () => {
    // ($2600 + $400) / 300 = $10 > $8
    const r = evaluateGlobalKill({ cumulativeSpend: 2600, totalMediaSubsidyCost: 400, totalInstalls: 300 })
    expect(r.decision).toBe('freeze_scaling')
  })
  it('continues when blended eCAC* healthy', () => {
    // ($2600 + $400) / 1000 = $3
    expect(
      evaluateGlobalKill({ cumulativeSpend: 2600, totalMediaSubsidyCost: 400, totalInstalls: 1000 }).decision,
    ).toBe('continue')
  })
})

describe('evaluateChannel routing', () => {
  it('suppresses auto-action on SKAN-immature iOS channels', () => {
    const r = evaluateChannel(base({ skanImmature: true }))
    expect(r.decision).toBe('insufficient_data')
    expect(r.reasons.join()).toContain('SKAN')
  })
  it('routes to the highest milestone gate met', () => {
    // healthy, high spend, 40 paying → Gate C scale
    expect(evaluateChannel(base({ spend: 1300, payingUsers: 40 })).decision).toBe('scale')
  })
  it('falls back to Gate A kill at low spend', () => {
    expect(evaluateChannel(base({ spend: 400, installs: 10 })).decision).toBe('kill')
  })
})
