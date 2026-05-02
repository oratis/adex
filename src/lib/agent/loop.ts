import { prisma } from '@/lib/prisma'
import { perceive } from './perceive'
import { plan } from './plan'
import { act } from './act'
import type { AgentMode, AgentRunResult } from './types'

/**
 * runAgentLoop — one full cycle for a single org.
 *
 * Order: kill-switch check → AgentConfig.mode → perceive → plan (LLM) →
 * act (tools or shadow). Verify is deliberately a separate cron because it
 * runs hours after Decisions are recorded.
 */
export async function runAgentLoop(opts: {
  orgId: string
  triggerType?: 'cron' | 'manual' | 'webhook'
}): Promise<AgentRunResult> {
  const triggerType = opts.triggerType || 'cron'
  const errors: string[] = []

  const config =
    (await prisma.agentConfig.findUnique({ where: { orgId: opts.orgId } })) ||
    (await prisma.agentConfig.create({
      data: { orgId: opts.orgId, enabled: false, mode: 'shadow' },
    }))

  const result: AgentRunResult = {
    orgId: opts.orgId,
    decisionsCreated: 0,
    decisionsExecuted: 0,
    decisionsSkipped: 0,
    decisionsAwaitingApproval: 0,
    llmCostUsd: 0,
    errors,
  }

  if (!config.enabled) {
    errors.push('agent disabled for this org (AgentConfig.enabled=false)')
    return result
  }
  if (config.killSwitch) {
    errors.push(`kill switch active: ${config.killSwitchReason || 'no reason recorded'}`)
    return result
  }

  let snapshot
  try {
    snapshot = await perceive(opts.orgId)
  } catch (err) {
    errors.push(`perceive failed: ${err instanceof Error ? err.message : String(err)}`)
    return result
  }
  if (snapshot.campaigns.length === 0) {
    return result // nothing to plan against
  }

  let planResult
  try {
    planResult = await plan(snapshot)
  } catch (err) {
    errors.push(`plan failed: ${err instanceof Error ? err.message : String(err)}`)
    return result
  }

  result.llmCostUsd = planResult.llm.costUsd

  if (planResult.decisions.length === 0) {
    // No decisions, but the LLM call still cost money — charge it.
    await prisma.agentConfig.update({
      where: { orgId: opts.orgId },
      data: { monthlyLlmSpentUsd: { increment: planResult.llm.costUsd } },
    })
    return result
  }

  // Audit High #8: charge AFTER act() succeeds. Previously we charged
  // before, which meant a thrown exception in act() recorded cost without
  // recording the decisions — partial-failure budget leak.
  let summary: Awaited<ReturnType<typeof act>>
  try {
    summary = await act({
      orgId: opts.orgId,
      mode: config.mode as AgentMode,
      triggerType,
      promptVersion: planResult.promptVersionId,
      llm: planResult.llm,
      proposed: planResult.decisions,
      perceiveContextJson: JSON.stringify(snapshot),
    })
  } catch (err) {
    errors.push(`act failed: ${err instanceof Error ? err.message : String(err)}`)
    // Charge the LLM cost even on act() failure — the LLM call already
    // happened. Without this, we'd undercount spend; the bug is in act,
    // not in the planning that consumed tokens.
    await prisma.agentConfig.update({
      where: { orgId: opts.orgId },
      data: { monthlyLlmSpentUsd: { increment: planResult.llm.costUsd } },
    })
    return result
  }
  // Happy path: charge after success
  await prisma.agentConfig.update({
    where: { orgId: opts.orgId },
    data: { monthlyLlmSpentUsd: { increment: planResult.llm.costUsd } },
  })

  result.decisionsCreated = summary.created
  result.decisionsExecuted = summary.executed
  result.decisionsSkipped = summary.skipped
  result.decisionsAwaitingApproval = summary.awaitingApproval

  // Attribute this cycle's PromptRun to the most-recent decisions of the same
  // promptVersion (1 plan call → N decisions; pick the N most recent).
  if (planResult.promptRunId && summary.created > 0) {
    try {
      const recent = await prisma.decision.findMany({
        where: { orgId: opts.orgId, promptVersion: planResult.promptVersionId },
        orderBy: { createdAt: 'desc' },
        take: summary.created,
      })
      if (recent.length > 0) {
        await prisma.promptRun.update({
          where: { id: planResult.promptRunId },
          data: { decisionId: recent[0].id },
        })
      }
    } catch (e) {
      console.error('[loop] PromptRun attribution failed:', e)
    }
  }

  return result
}
