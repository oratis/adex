import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runAgentLoop } from '@/lib/agent/loop'
import { verify } from '@/lib/agent/verify'
import { captureCampaignSnapshots, detectDrift } from '@/lib/sync/snapshot'
import { getAdapter, isAdaptablePlatform } from '@/lib/platforms/registry'
import { checkRegressionDowngrade } from '@/lib/agent/safeguards'
import { verifyCronAuth } from '@/lib/cron-auth'

/**
 * POST /api/cron/agent
 *
 * Hourly tick. For every org with AgentConfig.enabled=true:
 *   1. Capture platform snapshots (every active adaptable platform)
 *   2. Detect drift (update Campaign.syncedStatus/syncError)
 *   3. Run the agent loop (perceive → plan → act)
 *   4. Verify any executed decisions whose 24h window has elapsed
 *
 * Auth: same X-Cron-Secret header as /api/cron/daily.
 *
 * Audit High #15: cap orgs per tick + per-org timeout so one slow org can't
 * monopolise the cron window.
 */

// Configurable bounds for the cron run. Defaults are safe for a small
// install (~100 orgs); tune via env when the platform scales.
const MAX_ORGS_PER_TICK = Number(process.env.AGENT_CRON_MAX_ORGS_PER_TICK || 200)
const PER_ORG_TIMEOUT_MS = Number(process.env.AGENT_CRON_PER_ORG_TIMEOUT_MS || 90_000)

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

export async function POST(req: NextRequest) {
  if (!(await verifyCronAuth(req, 'agent'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Page through enabled configs deterministically (orgId asc) so cursor
  // resume is possible if/when we split this across multiple ticks.
  const cursorParam = req.nextUrl.searchParams.get('cursor') || undefined
  const enabledConfigs = await prisma.agentConfig.findMany({
    where: { enabled: true, killSwitch: false },
    orderBy: { orgId: 'asc' },
    take: MAX_ORGS_PER_TICK + 1, // +1 to detect "more"
    ...(cursorParam ? { cursor: { orgId: cursorParam }, skip: 1 } : {}),
  })
  const hasMore = enabledConfigs.length > MAX_ORGS_PER_TICK
  if (hasMore) enabledConfigs.length = MAX_ORGS_PER_TICK
  const nextCursor = hasMore ? enabledConfigs[enabledConfigs.length - 1].orgId : null

  const summary: Array<{
    orgId: string
    snapshots: { taken: number; orphans: number }
    drift: { checked: number; drifted: number; approvalsCreated: number }
    agent: Awaited<ReturnType<typeof runAgentLoop>>
    timedOut?: boolean
  }> = []

  for (const cfg of enabledConfigs) {
    const orgWork = (async () => {
      const auths = await prisma.platformAuth.findMany({
        where: { orgId: cfg.orgId, isActive: true },
      })
      let snapshotsTotal = 0
      let orphansTotal = 0
      let driftedTotal = 0
      let checkedTotal = 0
      let approvalsTotal = 0
      for (const auth of auths) {
        if (!isAdaptablePlatform(auth.platform)) continue
        try {
          const adapter = getAdapter(auth.platform, auth)
          const snap = await captureCampaignSnapshots({ adapter, orgId: cfg.orgId })
          snapshotsTotal += snap.snapshotsTaken
          orphansTotal += snap.orphans
          const drift = await detectDrift({ orgId: cfg.orgId, platform: auth.platform })
          checkedTotal += drift.checked
          driftedTotal += drift.drifted
          approvalsTotal += drift.approvalsCreated
        } catch (err) {
          console.error(
            `[cron/agent] snapshot/drift failed for ${cfg.orgId}/${auth.platform}:`,
            err
          )
        }
      }

      let agent: Awaited<ReturnType<typeof runAgentLoop>>
      try {
        agent = await runAgentLoop({ orgId: cfg.orgId, triggerType: 'cron' })
      } catch (err) {
        agent = {
          orgId: cfg.orgId,
          decisionsCreated: 0,
          decisionsExecuted: 0,
          decisionsSkipped: 0,
          decisionsAwaitingApproval: 0,
          llmCostUsd: 0,
          errors: [`runAgentLoop threw: ${err instanceof Error ? err.message : String(err)}`],
        }
      }

      return {
        orgId: cfg.orgId,
        snapshots: { taken: snapshotsTotal, orphans: orphansTotal },
        drift: { checked: checkedTotal, drifted: driftedTotal, approvalsCreated: approvalsTotal },
        agent,
      }
    })()

    try {
      const r = await withTimeout(orgWork, PER_ORG_TIMEOUT_MS, `org ${cfg.orgId}`)
      summary.push(r)
    } catch (err) {
      console.error(`[cron/agent] per-org work failed/timed out for ${cfg.orgId}:`, err)
      summary.push({
        orgId: cfg.orgId,
        snapshots: { taken: 0, orphans: 0 },
        drift: { checked: 0, drifted: 0, approvalsCreated: 0 },
        agent: {
          orgId: cfg.orgId,
          decisionsCreated: 0,
          decisionsExecuted: 0,
          decisionsSkipped: 0,
          decisionsAwaitingApproval: 0,
          llmCostUsd: 0,
          errors: [`org work failed: ${err instanceof Error ? err.message : String(err)}`],
        },
        timedOut: true,
      })
    }
  }

  // Verify across all orgs in one pass, then run regression safeguards
  // per-org. (Verify must complete before downgrade can find new outcomes.)
  const verified = await verify({})
  const downgrades: Array<{ orgId: string; before: string; after: string; reason: string }> = []
  for (const cfg of enabledConfigs) {
    try {
      const dg = await withTimeout(
        checkRegressionDowngrade({ orgId: cfg.orgId }),
        PER_ORG_TIMEOUT_MS,
        `downgrade ${cfg.orgId}`
      )
      if (dg) downgrades.push(dg)
    } catch (err) {
      console.error(`[cron/agent] downgrade check failed for ${cfg.orgId}:`, err)
    }
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    orgs: summary,
    verified,
    downgrades,
    pagination: { hasMore, nextCursor, processed: summary.length, cap: MAX_ORGS_PER_TICK },
  })
}
