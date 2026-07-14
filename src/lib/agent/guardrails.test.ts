import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted — define the prisma stub inside the factory so it's
// initialised before the module under test imports it.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentConfig: { findUnique: vi.fn() },
    campaign: { findFirst: vi.fn() },
    decisionStep: { findFirst: vi.fn(), count: vi.fn() },
    platformLink: { findFirst: vi.fn(), findMany: vi.fn() },
    campaignSnapshot: { findFirst: vi.fn() },
    report: { findMany: vi.fn(), aggregate: vi.fn() },
    guardrail: { findMany: vi.fn() },
    cohortSnapshot: { findFirst: vi.fn() },
    budget: { findFirst: vi.fn() },
  },
}))

import { evaluateGuardrails, isBlocked } from './guardrails'
import type { ToolDefinition } from './types'
import { prisma } from '@/lib/prisma'

// Re-cast for typed mock access in beforeEach.
const mockedPrisma = prisma as unknown as {
  agentConfig: { findUnique: ReturnType<typeof vi.fn> }
  campaign: { findFirst: ReturnType<typeof vi.fn> }
  decisionStep: { findFirst: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> }
  platformLink: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }
  campaignSnapshot: { findFirst: ReturnType<typeof vi.fn> }
  report: { findMany: ReturnType<typeof vi.fn>; aggregate: ReturnType<typeof vi.fn> }
  guardrail: { findMany: ReturnType<typeof vi.fn> }
  cohortSnapshot: { findFirst: ReturnType<typeof vi.fn> }
  budget: { findFirst: ReturnType<typeof vi.fn> }
}

const tool = (name: string, riskLevel: 'low' | 'medium' | 'high' = 'low'): ToolDefinition<unknown> => ({
  name,
  description: '',
  inputSchema: {},
  reversible: true,
  riskLevel,
  validate: (i) => i,
  execute: async () => ({ ok: true, output: {} }),
})

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults: no AgentConfig (so llm_budget_cap passes), no recent
  // decision steps, no guardrail rows, no campaigns.
  mockedPrisma.agentConfig.findUnique.mockResolvedValue(null)
  mockedPrisma.campaign.findFirst.mockResolvedValue(null)
  mockedPrisma.decisionStep.findFirst.mockResolvedValue(null)
  mockedPrisma.decisionStep.count.mockResolvedValue(0)
  mockedPrisma.platformLink.findFirst.mockResolvedValue(null)
  mockedPrisma.platformLink.findMany.mockResolvedValue([])
  mockedPrisma.campaignSnapshot.findFirst.mockResolvedValue(null)
  mockedPrisma.report.findMany.mockResolvedValue([])
  mockedPrisma.report.aggregate.mockResolvedValue({ _sum: { spend: 0 } })
  mockedPrisma.guardrail.findMany.mockResolvedValue([])
  mockedPrisma.cohortSnapshot.findFirst.mockResolvedValue(null)
  mockedPrisma.budget.findFirst.mockResolvedValue(null)
})

describe('evaluateGuardrails — built-in defaults', () => {
  it('passes a noop step when nothing else applies', async () => {
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'noop', input: {} },
      tool: tool('noop', 'low'),
    })
    expect(isBlocked(results)).toBe(false)
  })

  it('blocks high-risk tools by default', async () => {
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'high'),
    })
    expect(isBlocked(results)).toBe(true)
    const failedRules = results.filter((r) => !r.pass).map((r) => r.rule)
    expect(failedRules).toContain('high_risk_requires_approval')
  })

  it('blocks pause when 24h spend below threshold', async () => {
    mockedPrisma.platformLink.findFirst.mockResolvedValueOnce({ id: 'lnk1' })
    mockedPrisma.report.findMany.mockResolvedValueOnce([
      { spend: 5, impressions: 100 },
    ])
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'pause_campaign', input: { campaignId: 'c1' } },
      tool: tool('pause_campaign', 'low'),
    })
    expect(isBlocked(results)).toBe(true)
    expect(results.find((r) => r.rule === 'pause_only_with_conversions')?.pass).toBe(false)
  })

  it('allows pause when 24h spend exceeds threshold', async () => {
    mockedPrisma.platformLink.findFirst.mockResolvedValueOnce({ id: 'lnk1' })
    mockedPrisma.report.findMany.mockResolvedValueOnce([
      { spend: 100, impressions: 5000 },
    ])
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'pause_campaign', input: { campaignId: 'c1' } },
      tool: tool('pause_campaign', 'low'),
    })
    expect(results.find((r) => r.rule === 'pause_only_with_conversions')?.pass).toBe(true)
  })

  it('blocks when monthly LLM budget is exhausted', async () => {
    mockedPrisma.agentConfig.findUnique.mockResolvedValueOnce({
      monthlyLlmBudgetUsd: 50,
      monthlyLlmSpentUsd: 50,
    })
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'noop', input: {} },
      tool: tool('noop', 'low'),
    })
    expect(results.find((r) => r.rule === 'llm_budget_cap')?.pass).toBe(false)
  })

  it('blocks tool exceeding max_per_day cap', async () => {
    mockedPrisma.decisionStep.count.mockResolvedValueOnce(20)
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'pause_campaign', input: { campaignId: 'c1' } },
      tool: tool('pause_campaign', 'low'),
    })
    expect(results.find((r) => r.rule === 'max_per_day')?.pass).toBe(false)
  })

  it('blocks duplicate step within cooldown window', async () => {
    const recentInput = JSON.stringify({ campaignId: 'c1' })
    mockedPrisma.decisionStep.findFirst.mockResolvedValueOnce({ toolInput: recentInput })
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'pause_campaign', input: { campaignId: 'c1' } },
      tool: tool('pause_campaign', 'low'),
    })
    expect(results.find((r) => r.rule === 'cooldown')?.pass).toBe(false)
  })
})

describe('evaluator error handling — fail-closed (audit High #9)', () => {
  it('blocks when llm_budget_cap evaluator throws (fail-closed rule)', async () => {
    // Make agentConfig.findUnique throw — that's what llm_budget_cap reads.
    mockedPrisma.agentConfig.findUnique.mockRejectedValueOnce(new Error('db down'))
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'noop', input: {} },
      tool: tool('noop', 'low'),
    })
    const r = results.find((r) => r.rule === 'llm_budget_cap')
    expect(r?.pass).toBe(false)
    expect(r?.reason).toContain('fail-closed')
  })

  it('blocks when managed_only evaluator throws (fail-closed rule)', async () => {
    mockedPrisma.campaign.findFirst.mockRejectedValueOnce(new Error('db down'))
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'pause_campaign', input: { campaignId: 'c1' } },
      tool: tool('pause_campaign', 'low'),
    })
    const r = results.find((r) => r.rule === 'managed_only')
    expect(r?.pass).toBe(false)
    expect(r?.reason).toContain('fail-closed')
  })
})

describe('isBlocked', () => {
  it('returns true if any result fails', () => {
    expect(
      isBlocked([
        { pass: true, rule: 'a' },
        { pass: false, rule: 'b' },
      ])
    ).toBe(true)
  })
  it('returns false when all pass', () => {
    expect(
      isBlocked([
        { pass: true, rule: 'a' },
        { pass: true, rule: 'b' },
      ])
    ).toBe(false)
  })
  it('returns false on empty array', () => {
    expect(isBlocked([])).toBe(false)
  })
})

describe('pilot_budget_cap', () => {
  it('not applicable to a non-spend-increasing tool', async () => {
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'pause_campaign', input: { campaignId: 'c1' } },
      tool: tool('pause_campaign', 'low'),
    })
    expect(results.find((r) => r.rule === 'pilot_budget_cap')?.pass).toBe(true)
  })

  it('inert when no pilotStartDate configured (no DB call)', async () => {
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'resume_campaign', input: { campaignId: 'c1' } },
      tool: tool('resume_campaign', 'low'),
    })
    expect(results.find((r) => r.rule === 'pilot_budget_cap')?.pass).toBe(true)
    expect(mockedPrisma.report.findMany).not.toHaveBeenCalled()
  })

  it('pass true, no reason, when spend is below warn threshold', async () => {
    mockedPrisma.guardrail.findMany.mockResolvedValueOnce([
      { rule: 'pilot_budget_cap', config: JSON.stringify({ pilotStartDate: '2026-01-01', capTotal: 5000 }) },
    ])
    mockedPrisma.report.findMany.mockResolvedValueOnce([{ spend: 1000 }])
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'resume_campaign', input: { campaignId: 'c1' } },
      tool: tool('resume_campaign', 'low'),
    })
    const r = results.find((r) => r.rule === 'pilot_budget_cap')
    expect(r?.pass).toBe(true)
    expect(r?.reason).toBeUndefined()
  })

  it('pass true with a warn reason at 80% of cap', async () => {
    mockedPrisma.guardrail.findMany.mockResolvedValueOnce([
      { rule: 'pilot_budget_cap', config: JSON.stringify({ pilotStartDate: '2026-01-01', capTotal: 5000 }) },
    ])
    mockedPrisma.report.findMany.mockResolvedValueOnce([{ spend: 4000 }])
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'resume_campaign', input: { campaignId: 'c1' } },
      tool: tool('resume_campaign', 'low'),
    })
    // Two evaluations run: the always-on builtin (config {}, inert — pass)
    // and the org-configured one (config with pilotStartDate). Check the
    // org-configured occurrence specifically (the one carrying a reason).
    const orgResult = results.filter((r) => r.rule === 'pilot_budget_cap').find((r) => r.reason)
    expect(orgResult?.pass).toBe(true)
    expect(orgResult?.reason).toBeDefined()
  })

  it('blocks at/above 95% of cap', async () => {
    mockedPrisma.guardrail.findMany.mockResolvedValueOnce([
      { rule: 'pilot_budget_cap', config: JSON.stringify({ pilotStartDate: '2026-01-01', capTotal: 5000 }) },
    ])
    mockedPrisma.report.findMany.mockResolvedValueOnce([{ spend: 4750 }])
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'resume_campaign', input: { campaignId: 'c1' } },
      tool: tool('resume_campaign', 'low'),
    })
    expect(results.some((r) => r.rule === 'pilot_budget_cap' && !r.pass)).toBe(true)
  })

  it('sums account-level rows only — campaign rows duplicate the same spend', async () => {
    mockedPrisma.guardrail.findMany.mockResolvedValueOnce([
      { rule: 'pilot_budget_cap', config: JSON.stringify({ pilotStartDate: '2026-01-01', capTotal: 5000 }) },
    ])
    mockedPrisma.report.findMany.mockResolvedValueOnce([{ spend: 1000 }])
    await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'resume_campaign', input: { campaignId: 'c1' } },
      tool: tool('resume_campaign', 'low'),
    })
    expect(mockedPrisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ level: 'account' }),
      })
    )
  })

  it('fail-closed: blocks if the DB read throws', async () => {
    mockedPrisma.guardrail.findMany.mockResolvedValueOnce([
      { rule: 'pilot_budget_cap', config: JSON.stringify({ pilotStartDate: '2026-01-01' }) },
    ])
    mockedPrisma.report.findMany.mockRejectedValueOnce(new Error('db down'))
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'resume_campaign', input: { campaignId: 'c1' } },
      tool: tool('resume_campaign', 'low'),
    })
    const r = results.filter((r) => r.rule === 'pilot_budget_cap').find((r) => !r.pass)
    expect(r?.pass).toBe(false)
    expect(r?.reason).toContain('fail-closed')
  })
})

describe('skan_maturity', () => {
  it('not applicable to an irrelevant tool', async () => {
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'pause_campaign', input: { campaignId: 'c1' } },
      tool: tool('pause_campaign', 'low'),
    })
    expect(results.find((r) => r.rule === 'skan_maturity')?.pass).toBe(true)
  })

  it('passes non-SKAN campaigns (e.g. google platform)', async () => {
    mockedPrisma.campaign.findFirst.mockResolvedValue({
      platform: 'google',
      objective: 'app_install',
      startDate: new Date(),
      managedByAgent: true,
    })
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    expect(results.find((r) => r.rule === 'skan_maturity')?.pass).toBe(true)
  })

  it('fail-closed rejects SKAN campaign with unknown startDate', async () => {
    mockedPrisma.campaign.findFirst.mockResolvedValue({
      platform: 'meta',
      objective: 'app_install',
      startDate: null,
      managedByAgent: true,
    })
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    expect(results.find((r) => r.rule === 'skan_maturity')?.pass).toBe(false)
  })

  it('rejects SKAN campaign younger than 72h', async () => {
    mockedPrisma.campaign.findFirst.mockResolvedValue({
      platform: 'meta',
      objective: 'app_install',
      startDate: new Date(Date.now() - 10 * 60 * 60 * 1000), // 10h old
      managedByAgent: true,
    })
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    expect(results.find((r) => r.rule === 'skan_maturity')?.pass).toBe(false)
  })

  it('warns (does not reject) in learning window (day 3) under 2x daily cap', async () => {
    mockedPrisma.campaign.findFirst.mockResolvedValue({
      platform: 'meta',
      objective: 'app_install',
      startDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days old
      managedByAgent: true,
    })
    mockedPrisma.budget.findFirst.mockResolvedValueOnce({ amount: 100 })
    mockedPrisma.report.findMany.mockResolvedValueOnce([{ spend: 50 }])
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    const r = results.find((r) => r.rule === 'skan_maturity')
    expect(r?.pass).toBe(true)
  })

  it('rejects learning-window spend over 2x daily cap', async () => {
    mockedPrisma.campaign.findFirst.mockResolvedValue({
      platform: 'meta',
      objective: 'app_install',
      startDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      managedByAgent: true,
    })
    mockedPrisma.budget.findFirst.mockResolvedValueOnce({ amount: 100 })
    mockedPrisma.report.findMany.mockResolvedValueOnce([{ spend: 250 }])
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    expect(results.find((r) => r.rule === 'skan_maturity')?.pass).toBe(false)
  })

  it('passes SKAN campaigns older than 7 days without further restriction', async () => {
    mockedPrisma.campaign.findFirst.mockResolvedValue({
      platform: 'tiktok',
      objective: 'app_install',
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      managedByAgent: true,
    })
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    expect(results.find((r) => r.rule === 'skan_maturity')?.pass).toBe(true)
  })
})

describe('tier_cac_ceiling', () => {
  it('passes a non-increase input (bid decrease)', async () => {
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 3, previousBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    expect(results.find((r) => r.rule === 'tier_cac_ceiling')?.pass).toBe(true)
  })

  it('passes an increase with no derivable channel', async () => {
    mockedPrisma.campaign.findFirst.mockResolvedValue({ platform: 'google', objective: 'web_conversion', managedByAgent: true })
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    expect(results.find((r) => r.rule === 'tier_cac_ceiling')?.pass).toBe(true)
  })

  it('passes with a warn reason when no CohortSnapshot found for a derivable channel', async () => {
    mockedPrisma.campaign.findFirst.mockResolvedValue({ platform: 'meta', objective: 'app_install', managedByAgent: true })
    mockedPrisma.cohortSnapshot.findFirst.mockResolvedValueOnce(null)
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    const r = results.find((r) => r.rule === 'tier_cac_ceiling')
    expect(r?.pass).toBe(true)
    expect(r?.reason).toBeDefined()
  })

  it('passes when CohortSnapshot.cac is within ceiling', async () => {
    mockedPrisma.campaign.findFirst.mockResolvedValue({ platform: 'meta', objective: 'app_install', managedByAgent: true })
    mockedPrisma.cohortSnapshot.findFirst.mockResolvedValueOnce({ cac: 20 })
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    expect(results.find((r) => r.rule === 'tier_cac_ceiling')?.pass).toBe(true)
  })

  it('rejects when CohortSnapshot.cac exceeds the ceiling (firstMonthNet default 8.5 × 5 = 42.5)', async () => {
    mockedPrisma.campaign.findFirst.mockResolvedValue({ platform: 'meta', objective: 'app_install', managedByAgent: true })
    mockedPrisma.cohortSnapshot.findFirst.mockResolvedValueOnce({ cac: 50 })
    const results = await evaluateGuardrails({
      orgId: 'o1',
      step: { tool: 'adjust_bid', input: { campaignId: 'c1', newBidUsd: 5 } },
      tool: tool('adjust_bid', 'low'),
    })
    expect(results.find((r) => r.rule === 'tier_cac_ceiling')?.pass).toBe(false)
  })
})
