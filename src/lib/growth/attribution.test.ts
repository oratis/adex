import { describe, it, expect } from 'vitest'
import { attributePost } from './attribution'

// Baseline 10/day for the week before; publish 2026-07-10; window spikes.
function series(spike: Record<string, number>): Map<string, number> {
  const m = new Map<string, number>()
  for (let d = 1; d <= 9; d++) m.set(`2026-07-0${d}`, 10) // 07-01..07-09 = 10/day
  for (const [k, v] of Object.entries(spike)) m.set(k, v)
  return m
}

describe('attributePost — natural uplift', () => {
  it('computes uplift above a flat baseline and effective CPI', () => {
    // baseline 10/day × 3-day window = 30 expected; observed 40+30+20 = 90 → uplift 60
    const r = attributePost({
      publishedAt: new Date('2026-07-10T12:00:00Z'),
      installsByDay: series({ '2026-07-10': 40, '2026-07-11': 30, '2026-07-12': 20 }),
      costUsd: 300,
      baselineDays: 7,
      windowDays: 3,
    })
    expect(r.baselineDailyInstalls).toBeCloseTo(10)
    expect(r.baselineInstalls).toBeCloseTo(30)
    expect(r.windowInstalls).toBe(90)
    expect(r.upliftInstalls).toBeCloseTo(60)
    expect(r.effectiveCpi).toBeCloseTo(5) // $300 / 60
  })

  it('clamps uplift to zero when the window underperforms the baseline', () => {
    const r = attributePost({
      publishedAt: new Date('2026-07-10T00:00:00Z'),
      installsByDay: series({ '2026-07-10': 5, '2026-07-11': 5, '2026-07-12': 5 }),
      costUsd: 300,
    })
    expect(r.upliftInstalls).toBe(0)
    expect(r.effectiveCpi).toBeNull()
  })

  it('treats missing days as zero installs', () => {
    const r = attributePost({
      publishedAt: new Date('2026-07-10T00:00:00Z'),
      installsByDay: new Map([['2026-07-10', 12]]), // no baseline days present
      costUsd: 60,
      windowDays: 1,
    })
    expect(r.baselineDailyInstalls).toBe(0)
    expect(r.upliftInstalls).toBe(12)
    expect(r.effectiveCpi).toBeCloseTo(5)
  })
})
