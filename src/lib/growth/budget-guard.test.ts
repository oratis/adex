import { describe, it, expect } from 'vitest'
import {
  evaluatePilotBudget,
  evaluateChannelBreach,
  tierCacCeiling,
  withinCacCeiling,
} from './budget-guard'

describe('evaluatePilotBudget — global pacing', () => {
  it('ok below 80%', () => {
    expect(evaluatePilotBudget({ cumulativeSpend: 3000 }).action).toBe('ok')
  })
  it('warns at 80%', () => {
    expect(evaluatePilotBudget({ cumulativeSpend: 4000 }).action).toBe('warn')
  })
  it('auto-pauses at 95% ($4,750)', () => {
    const r = evaluatePilotBudget({ cumulativeSpend: 4750 })
    expect(r.action).toBe('auto_pause')
    expect(r.pct).toBeCloseTo(0.95)
  })
})

describe('evaluateChannelBreach — one-directional, protected', () => {
  const norm = { spendToday: 50, dailyCap: 60, cpi: 4, targetCpi: 4, installs: 100, ageDays: 14 }

  it('ok when within caps', () => {
    expect(evaluateChannelBreach(norm).action).toBe('ok')
  })
  it('auto-pauses on >150% daily spend (mature channel)', () => {
    expect(evaluateChannelBreach({ ...norm, spendToday: 100 }).action).toBe('auto_pause')
  })
  it('auto-pauses on CPI > 3× target with enough installs', () => {
    expect(evaluateChannelBreach({ ...norm, cpi: 13, installs: 40 }).action).toBe('auto_pause')
  })
  it('does NOT auto-pause on a CPI breach with too few installs', () => {
    expect(evaluateChannelBreach({ ...norm, cpi: 13, installs: 10 }).action).toBe('ok')
  })
  it('protects the learning phase: breach only warns (<200%)', () => {
    const r = evaluateChannelBreach({ ...norm, spendToday: 100, ageDays: 3 })
    expect(r.action).toBe('warn')
  })
  it('still auto-pauses a runaway (>200%) even in learning phase', () => {
    expect(evaluateChannelBreach({ ...norm, spendToday: 130, ageDays: 3 }).action).toBe('auto_pause')
  })
  it('never auto-pauses a SKAN-immature channel (alerts only)', () => {
    const r = evaluateChannelBreach({ ...norm, spendToday: 200, skanImmature: true })
    expect(r.action).toBe('warn')
  })
})

describe('tier CAC ceiling', () => {
  it('ceiling = first-month net × payback multiple', () => {
    expect(tierCacCeiling(8.5)).toBeCloseTo(42.5)
    expect(tierCacCeiling(8.5, 3)).toBeCloseTo(25.5)
  })
  it('withinCacCeiling honors null', () => {
    expect(withinCacCeiling(32.5, 42.5)).toBe(true)
    expect(withinCacCeiling(50, 42.5)).toBe(false)
    expect(withinCacCeiling(null, 42.5)).toBe(false)
  })
})
