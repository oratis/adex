import { describe, it, expect } from 'vitest'
import { canTransitionMode, transitionFields } from './onboarding'
import type { AgentConfig } from '@/generated/prisma/client'

const baseCfg = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 'cfg1',
  orgId: 'org1',
  enabled: true,
  mode: 'shadow',
  killSwitch: false,
  killSwitchReason: null,
  killSwitchAt: null,
  monthlyLlmBudgetUsd: 50,
  monthlyLlmSpentUsd: 0,
  budgetResetAt: null,
  autonomousAllowed: false,
  autonomousAllowedAt: null,
  autonomousAllowedBy: null,
  shadowStartedAt: null,
  approvalOnlyStartedAt: null,
  autonomousStartedAt: null,
  updatedBy: null,
  updatedAt: new Date(),
  createdAt: new Date(),
  ...overrides,
})

describe('canTransitionMode', () => {
  it('allows same-mode no-op', () => {
    const r = canTransitionMode(baseCfg({ mode: 'shadow' }), 'shadow')
    expect(r.allowed).toBe(true)
  })

  it('blocks shadow → approval_only without dwell', () => {
    const r = canTransitionMode(baseCfg({ mode: 'shadow', shadowStartedAt: new Date() }), 'approval_only')
    expect(r.allowed).toBe(false)
  })

  it('allows shadow → approval_only after 8 days', () => {
    const r = canTransitionMode(
      baseCfg({ mode: 'shadow', shadowStartedAt: new Date(Date.now() - 8 * 24 * 3_600_000) }),
      'approval_only'
    )
    expect(r.allowed).toBe(true)
  })

  it('blocks autonomous without allowlist', () => {
    const r = canTransitionMode(
      baseCfg({
        mode: 'approval_only',
        approvalOnlyStartedAt: new Date(Date.now() - 30 * 24 * 3_600_000),
      }),
      'autonomous'
    )
    expect(r.allowed).toBe(false)
  })

  it('allows autonomous when allowlisted + dwelled', () => {
    const r = canTransitionMode(
      baseCfg({
        mode: 'approval_only',
        approvalOnlyStartedAt: new Date(Date.now() - 30 * 24 * 3_600_000),
        autonomousAllowed: true,
      }),
      'autonomous'
    )
    expect(r.allowed).toBe(true)
  })

  it('blocks skipping shadow → autonomous directly', () => {
    const r = canTransitionMode(baseCfg({ mode: 'shadow', autonomousAllowed: true }), 'autonomous')
    expect(r.allowed).toBe(false)
  })

  it('always allows downgrade by default', () => {
    const r = canTransitionMode(baseCfg({ mode: 'autonomous' }), 'shadow')
    expect(r.allowed).toBe(true)
  })

  it('refuses downgrade when allowDowngrade=false', () => {
    const r = canTransitionMode(
      baseCfg({ mode: 'autonomous' }),
      'shadow',
      { allowDowngrade: false }
    )
    expect(r.allowed).toBe(false)
  })
})

describe('transitionFields', () => {
  it('stamps shadowStartedAt for shadow', () => {
    const f = transitionFields('shadow')
    expect(f.mode).toBe('shadow')
    expect(f.shadowStartedAt).toBeInstanceOf(Date)
  })
  it('stamps approvalOnlyStartedAt for approval_only', () => {
    const f = transitionFields('approval_only')
    expect(f.approvalOnlyStartedAt).toBeInstanceOf(Date)
  })
  it('stamps autonomousStartedAt for autonomous', () => {
    const f = transitionFields('autonomous')
    expect(f.autonomousStartedAt).toBeInstanceOf(Date)
  })
})
