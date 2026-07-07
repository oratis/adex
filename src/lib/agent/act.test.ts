import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted — define stubs inside the factory so they're
// initialised before the module under test imports them.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    decision: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    decisionStep: { update: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    pendingApproval: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('./tools', () => ({
  getTool: vi.fn(),
}))

vi.mock('./guardrails', () => ({
  evaluateGuardrails: vi.fn(),
  isBlocked: vi.fn((results: Array<{ pass: boolean }>) => results.some((r) => !r.pass)),
}))

vi.mock('@/lib/webhooks', () => ({
  fireWebhook: vi.fn(() => Promise.resolve()),
}))

vi.mock('./notify', () => ({
  notifyApprovers: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(() => Promise.resolve()),
}))

import { executeApprovedDecision } from './act'
import { prisma } from '@/lib/prisma'
import { getTool } from './tools'
import { evaluateGuardrails } from './guardrails'
import { logAudit } from '@/lib/audit'

const mockedPrisma = prisma as unknown as {
  decision: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  decisionStep: { update: ReturnType<typeof vi.fn> }
}
const mockedGetTool = getTool as unknown as ReturnType<typeof vi.fn>
const mockedEvaluateGuardrails = evaluateGuardrails as unknown as ReturnType<typeof vi.fn>
const mockedLogAudit = logAudit as unknown as ReturnType<typeof vi.fn>

function makeTool(execute = vi.fn(async () => ({ ok: true, output: {} }))) {
  return {
    name: 'adjust_daily_budget',
    description: '',
    inputSchema: {},
    reversible: true,
    riskLevel: 'medium' as const,
    validate: (i: unknown) => i,
    execute,
  }
}

function makeStep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step1',
    decisionId: 'd1',
    stepIndex: 0,
    toolName: 'adjust_daily_budget',
    toolInput: JSON.stringify({ campaignId: 'c1', newDailyBudget: 100 }),
    toolOutput: null,
    status: 'pending',
    guardrailReport: null,
    platformResponse: null,
    platformLinkId: null,
    reversible: true,
    rollbackOf: null,
    executedAt: null,
    createdAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPrisma.decision.update.mockResolvedValue({})
  mockedPrisma.decisionStep.update.mockResolvedValue({})
})

describe('executeApprovedDecision — fresh guardrail re-check', () => {
  it('blocks a step when the fresh re-check finds a violation (non-rollback)', async () => {
    const execute = vi.fn(async () => ({ ok: true, output: {} }))
    const tool = makeTool(execute)
    mockedGetTool.mockReturnValue(tool)
    const step = makeStep()
    mockedPrisma.decision.findFirst.mockResolvedValue({
      id: 'd1',
      orgId: 'o1',
      steps: [step],
    })
    mockedEvaluateGuardrails.mockResolvedValue([
      { pass: false, rule: 'pilot_budget_cap', reason: 'over cap' },
    ])

    const result = await executeApprovedDecision('o1', 'd1', 'autonomous')

    expect(execute).not.toHaveBeenCalled()
    expect(mockedPrisma.decisionStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'step1' },
        data: expect.objectContaining({ status: 'blocked' }),
      })
    )
    expect(mockedLogAudit).toHaveBeenCalled()
    expect(result.status).toBe('failed')
  })

  it('proceeds normally when the fresh re-check passes', async () => {
    const execute = vi.fn(async () => ({ ok: true, output: {} }))
    const tool = makeTool(execute)
    mockedGetTool.mockReturnValue(tool)
    const step = makeStep()
    mockedPrisma.decision.findFirst.mockResolvedValue({
      id: 'd1',
      orgId: 'o1',
      steps: [step],
    })
    mockedEvaluateGuardrails.mockResolvedValue([{ pass: true, rule: 'pilot_budget_cap' }])

    const result = await executeApprovedDecision('o1', 'd1', 'autonomous')

    expect(execute).toHaveBeenCalled()
    expect(result.status).toBe('executed')
  })
})

describe('executeApprovedDecision — rollback exemption', () => {
  // Rollback detection signal: DecisionStep.rollbackOf is set on every
  // inverse step created by both decisions/[id]/rollback and
  // decisions/bulk-rollback routes.
  it('executes despite pilot_budget_cap / tier_cac_ceiling violations when rolling back', async () => {
    const execute = vi.fn(async () => ({ ok: true, output: {} }))
    const tool = makeTool(execute)
    mockedGetTool.mockReturnValue(tool)
    const step = makeStep({ rollbackOf: 'original-step-1' })
    mockedPrisma.decision.findFirst.mockResolvedValue({
      id: 'd1',
      orgId: 'o1',
      steps: [step],
    })
    mockedEvaluateGuardrails.mockResolvedValue([
      { pass: false, rule: 'pilot_budget_cap', reason: 'over cap' },
      { pass: false, rule: 'tier_cac_ceiling', reason: 'cac too high' },
    ])

    const result = await executeApprovedDecision('o1', 'd1', 'autonomous')

    expect(execute).toHaveBeenCalled()
    expect(result.status).toBe('executed')
  })

  it('executes despite a skan_maturity violation alone when rolling back (warn-only)', async () => {
    const execute = vi.fn(async () => ({ ok: true, output: {} }))
    const tool = makeTool(execute)
    mockedGetTool.mockReturnValue(tool)
    const step = makeStep({ rollbackOf: 'original-step-1' })
    mockedPrisma.decision.findFirst.mockResolvedValue({
      id: 'd1',
      orgId: 'o1',
      steps: [step],
    })
    mockedEvaluateGuardrails.mockResolvedValue([
      { pass: false, rule: 'skan_maturity', reason: 'campaign too young' },
    ])

    const result = await executeApprovedDecision('o1', 'd1', 'autonomous')

    expect(execute).toHaveBeenCalled()
    expect(result.status).toBe('executed')
  })

  it('still blocks a rollback step on an unrelated violated rule', async () => {
    const execute = vi.fn(async () => ({ ok: true, output: {} }))
    const tool = makeTool(execute)
    mockedGetTool.mockReturnValue(tool)
    const step = makeStep({ rollbackOf: 'original-step-1' })
    mockedPrisma.decision.findFirst.mockResolvedValue({
      id: 'd1',
      orgId: 'o1',
      steps: [step],
    })
    mockedEvaluateGuardrails.mockResolvedValue([
      { pass: false, rule: 'high_risk_requires_approval', reason: 'high risk' },
    ])

    const result = await executeApprovedDecision('o1', 'd1', 'autonomous')

    expect(execute).not.toHaveBeenCalled()
    expect(result.status).toBe('failed')
  })
})
