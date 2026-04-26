import { prisma } from '@/lib/prisma'
import { fireWebhook } from '@/lib/webhooks'

/**
 * Auto-safeguards — run after `verify` completes for an org. If the most
 * recent verified DecisionOutcome stream shows N consecutive regressions
 * (default 3), demote AgentConfig.mode from autonomous → approval_only
 * (or approval_only → shadow) and broadcast a kill-switch-style webhook.
 *
 * Per docs/agent/09-roadmap.md §Phase 16 work item 4. Idempotent — re-running
 * a no-op cycle is fine.
 */
export type DowngradeResult = {
  orgId: string
  before: string
  after: string
  reason: string
} | null

const DOWNGRADE_LADDER: Record<string, string | null> = {
  autonomous: 'approval_only',
  approval_only: 'shadow',
  shadow: null,
}

export async function checkRegressionDowngrade(opts: {
  orgId: string
  consecutiveThreshold?: number
}): Promise<DowngradeResult> {
  const threshold = opts.consecutiveThreshold ?? 3

  const config = await prisma.agentConfig.findUnique({ where: { orgId: opts.orgId } })
  if (!config || !config.enabled || config.killSwitch) return null
  const nextMode = DOWNGRADE_LADDER[config.mode]
  if (!nextMode) return null // shadow is the floor

  // Look at the last `threshold` verified decisions; if all are regressions, downgrade.
  const recent = await prisma.decisionOutcome.findMany({
    where: { decision: { orgId: opts.orgId } },
    orderBy: { measuredAt: 'desc' },
    take: threshold,
    select: { classification: true },
  })
  if (recent.length < threshold) return null
  if (!recent.every((r) => r.classification === 'regression')) return null

  await prisma.agentConfig.update({
    where: { orgId: opts.orgId },
    data: { mode: nextMode },
  })

  const reason = `Auto-downgrade: ${threshold} consecutive verified regressions`
  fireWebhook({
    orgId: opts.orgId,
    event: 'agent.killswitch.activated',
    data: { kind: 'auto_downgrade', from: config.mode, to: nextMode, reason },
  }).catch(() => {})

  return { orgId: opts.orgId, before: config.mode, after: nextMode, reason }
}
