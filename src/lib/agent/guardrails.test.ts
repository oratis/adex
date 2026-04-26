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
    report: { findMany: vi.fn() },
    guardrail: { findMany: vi.fn() },
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
  report: { findMany: ReturnType<typeof vi.fn> }
  guardrail: { findMany: ReturnType<typeof vi.fn> }
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
  mockedPrisma.guardrail.findMany.mockResolvedValue([])
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
