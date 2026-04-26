import { prisma } from '@/lib/prisma'
import { fireWebhook } from '@/lib/webhooks'
import { getTool } from './tools'
import { evaluateGuardrails, isBlocked } from './guardrails'
import { notifyApprovers } from './notify'
import type {
  AgentMode,
  PlanResult,
  ProposedDecision,
  ToolContext,
  ToolResult,
} from './types'

type DecisionRecord = {
  decisionId: string
  status: 'pending' | 'executed' | 'failed' | 'skipped' | 'awaiting_approval'
  requiresApproval: boolean
}

/**
 * Persist + (conditionally) execute a single ProposedDecision.
 *
 * Behavior depends on `mode`:
 *   - shadow         → all steps recorded as status=skipped (LLM signal only)
 *   - approval_only  → Decision marked requiresApproval=true, steps left
 *                      pending; PendingApproval row created
 *   - autonomous     → guardrails evaluated; if any block, decision routed to
 *                      approval; otherwise tool.execute() is called per step
 */
async function processOne(
  orgId: string,
  mode: AgentMode,
  triggerType: string,
  llm: PlanResult['llm'],
  promptVersion: string,
  proposed: ProposedDecision
): Promise<DecisionRecord> {
  // Eagerly compute guardrails so we can decide on requiresApproval even in
  // approval_only / autonomous modes.
  const stepEvaluations = []
  for (const step of proposed.steps) {
    const tool = getTool(step.tool)
    if (!tool) {
      stepEvaluations.push({
        step,
        results: [{ pass: false, rule: 'unknown_tool', reason: `Tool ${step.tool} not registered` }],
        blocked: true,
      })
      continue
    }
    const results = await evaluateGuardrails({ orgId, step, tool })
    stepEvaluations.push({ step, results, blocked: isBlocked(results) })
  }
  const anyBlocked = stepEvaluations.some((e) => e.blocked)
  const requiresApproval = mode === 'approval_only' || (mode === 'autonomous' && anyBlocked)

  const decision = await prisma.decision.create({
    data: {
      orgId,
      triggerType,
      perceiveContext: '', // populated by caller via runAgentLoop
      promptVersion,
      llmInputTokens: llm.inputTokens,
      llmOutputTokens: llm.outputTokens,
      llmCostUsd: llm.costUsd,
      llmRequestId: llm.requestId || null,
      rationale: proposed.rationale,
      severity: proposed.severity,
      mode,
      status: mode === 'shadow' ? 'skipped' : requiresApproval ? 'pending' : 'executing',
      requiresApproval,
    },
  })

  // Persist all steps
  for (let i = 0; i < proposed.steps.length; i++) {
    const evaluation = stepEvaluations[i]
    const step = evaluation.step
    await prisma.decisionStep.create({
      data: {
        decisionId: decision.id,
        stepIndex: i,
        toolName: step.tool,
        toolInput: JSON.stringify(step.input),
        status: mode === 'shadow' ? 'skipped' : requiresApproval ? 'pending' : 'pending',
        guardrailReport: JSON.stringify(evaluation.results),
        reversible: getTool(step.tool)?.reversible ?? false,
      },
    })
  }

  fireWebhook({
    orgId,
    event: 'agent.decision.created',
    data: { decisionId: decision.id, mode, severity: proposed.severity, requiresApproval },
  }).catch(() => {})

  if (mode === 'shadow') {
    return { decisionId: decision.id, status: 'skipped', requiresApproval: false }
  }

  if (requiresApproval) {
    await prisma.pendingApproval.create({
      data: {
        orgId,
        decisionId: decision.id,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    })
    fireWebhook({
      orgId,
      event: 'agent.approval.requested',
      data: {
        decisionId: decision.id,
        severity: proposed.severity,
        rationale: proposed.rationale,
      },
    }).catch(() => {})
    notifyApprovers({ orgId, decisionId: decision.id, proposed }).catch((e) =>
      console.error('[act] notifyApprovers failed:', e)
    )
    return { decisionId: decision.id, status: 'awaiting_approval', requiresApproval: true }
  }

  // Autonomous + all guardrails passed — execute every step in order.
  return executeApprovedDecision(orgId, decision.id, mode)
}

/**
 * Execute every pending step of a Decision in order. Used by:
 *   - act.ts immediately after createing a Decision in autonomous mode
 *   - the approval handler when a human clicks "Approve"
 */
export async function executeApprovedDecision(
  orgId: string,
  decisionId: string,
  mode: AgentMode
): Promise<DecisionRecord> {
  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, orgId },
    include: { steps: { orderBy: { stepIndex: 'asc' } } },
  })
  if (!decision) throw new Error(`Decision ${decisionId} not found`)

  await prisma.decision.update({
    where: { id: decisionId },
    data: { status: 'executing', executedAt: new Date() },
  })

  let anyFailed = false
  for (const step of decision.steps) {
    if (step.status !== 'pending') continue
    const tool = getTool(step.toolName)
    if (!tool) {
      await prisma.decisionStep.update({
        where: { id: step.id },
        data: { status: 'failed', toolOutput: JSON.stringify({ error: 'unknown tool' }) },
      })
      anyFailed = true
      continue
    }

    let validInput: unknown
    try {
      validInput = tool.validate(JSON.parse(step.toolInput))
    } catch (err) {
      await prisma.decisionStep.update({
        where: { id: step.id },
        data: {
          status: 'failed',
          toolOutput: JSON.stringify({ error: err instanceof Error ? err.message : 'invalid input' }),
        },
      })
      anyFailed = true
      continue
    }

    const ctx: ToolContext = { orgId, decisionId, stepIndex: step.stepIndex, mode }
    let result: ToolResult
    try {
      result = await tool.execute(ctx, validInput)
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : 'tool threw' }
    }
    await prisma.decisionStep.update({
      where: { id: step.id },
      data: {
        status: result.ok ? 'executed' : 'failed',
        toolOutput: JSON.stringify(result.ok ? result.output : { error: result.error, code: result.code }),
        platformResponse: result.ok && result.platformResponse ? JSON.stringify(result.platformResponse) : null,
        platformLinkId: result.ok && result.platformLinkId ? result.platformLinkId : null,
        executedAt: new Date(),
      },
    })
    if (!result.ok) anyFailed = true
  }

  await prisma.decision.update({
    where: { id: decisionId },
    data: { status: anyFailed ? 'failed' : 'executed' },
  })

  fireWebhook({
    orgId,
    event: anyFailed ? 'agent.decision.failed' : 'agent.decision.executed',
    data: { decisionId, mode },
  }).catch(() => {})

  return { decisionId, status: anyFailed ? 'failed' : 'executed', requiresApproval: false }
}

/**
 * act() — entry from the loop. Creates one Decision per ProposedDecision and
 * dispatches per the active mode.
 */
export async function act(opts: {
  orgId: string
  mode: AgentMode
  triggerType: string
  promptVersion: string
  llm: PlanResult['llm']
  proposed: ProposedDecision[]
  perceiveContextJson: string
}) {
  const summary = {
    created: 0,
    executed: 0,
    skipped: 0,
    awaitingApproval: 0,
  }
  for (const p of opts.proposed) {
    const rec = await processOne(
      opts.orgId,
      opts.mode,
      opts.triggerType,
      opts.llm,
      opts.promptVersion,
      p
    )
    // Backfill perceiveContext with the snapshot we already serialized
    await prisma.decision.update({
      where: { id: rec.decisionId },
      data: { perceiveContext: opts.perceiveContextJson.slice(0, 64_000) },
    })
    summary.created++
    if (rec.status === 'executed') summary.executed++
    else if (rec.status === 'skipped') summary.skipped++
    else if (rec.status === 'awaiting_approval') summary.awaitingApproval++
  }
  return summary
}
