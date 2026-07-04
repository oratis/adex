import { describe, it, expect } from 'vitest'
import { summarizeGrowth, type CohortLike } from './agent-perceive'
import { CHANNELS } from './channels'

function row(p: Partial<CohortLike> & Pick<CohortLike, 'channel'>): CohortLike {
  return { installs: 0, activated: 0, d1Retained: 0, d7Retained: 0, subscribers: 0, revenueToDate: 0, cac: null, ...p }
}

describe('summarizeGrowth', () => {
  it('returns null with no rows', () => {
    expect(summarizeGrowth([])).toBeNull()
  })

  it('aggregates the funnel and per-channel gate', () => {
    const s = summarizeGrowth([
      row({ channel: CHANNELS.PAID_META_WEB, installs: 400, activated: 240, d1Retained: 130, d7Retained: 80, subscribers: 40, revenueToDate: 360, cac: 4 }),
      row({ channel: CHANNELS.PAID_ASA, installs: 200, activated: 120, d7Retained: 44, subscribers: 5, revenueToDate: 45, cac: 4 }),
    ])!
    expect(s.funnel.installs).toBe(600)
    expect(s.funnel.activationRate).toBeCloseTo(360 / 600)
    // meta_web: 40 paying, spend 1600 (≥ Gate C $1,250), cost/paying $40 ≤ $42.5 → scale
    const meta = s.channels.find((c) => c.channel === CHANNELS.PAID_META_WEB)!
    expect(meta.gate).toBe('scale')
    expect(meta.ecac).toBeCloseTo(4)
  })

  it('accumulates pilot budget across channels and emits hints', () => {
    // spends: 400×4 + 200×4 = 2400 → below 80% of $5k → ok
    const s = summarizeGrowth([
      row({ channel: CHANNELS.PAID_META_WEB, installs: 400, d7Retained: 80, subscribers: 40, revenueToDate: 360, cac: 4 }),
      row({ channel: CHANNELS.PAID_ASA, installs: 200, subscribers: 5, revenueToDate: 45, cac: 4 }),
    ])!
    expect(s.budget.cumulativeSpend).toBeCloseTo(2400)
    expect(s.budget.action).toBe('ok')
    // scale hint present for the qualifying channel
    expect(s.hints.some((h) => h.includes('scale'))).toBe(true)
  })

  it('flags the pilot budget when spend nears the cap', () => {
    const s = summarizeGrowth([row({ channel: CHANNELS.PAID_META_WEB, installs: 1000, cac: 4.8 })])!
    // 1000 × 4.8 = 4800 → 96% → auto_pause
    expect(s.budget.action).toBe('auto_pause')
    expect(s.hints.some((h) => h.includes('pilot budget'))).toBe(true)
  })
})
