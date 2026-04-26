import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runAgentLoop } from '@/lib/agent/loop'
import { verify } from '@/lib/agent/verify'
import { captureCampaignSnapshots, detectDrift } from '@/lib/sync/snapshot'
import { getAdapter, isAdaptablePlatform } from '@/lib/platforms/registry'
import { checkRegressionDowngrade } from '@/lib/agent/safeguards'

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
 */
function checkCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided =
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer /i, '')
  return provided === secret
}

export async function POST(req: NextRequest) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const enabledConfigs = await prisma.agentConfig.findMany({
    where: { enabled: true, killSwitch: false },
  })
  const summary: Array<{
    orgId: string
    snapshots: { taken: number; orphans: number }
    drift: { checked: number; drifted: number; approvalsCreated: number }
    agent: Awaited<ReturnType<typeof runAgentLoop>>
  }> = []

  for (const cfg of enabledConfigs) {
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
        console.error(`[cron/agent] snapshot/drift failed for ${cfg.orgId}/${auth.platform}:`, err)
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

    summary.push({
      orgId: cfg.orgId,
      snapshots: { taken: snapshotsTotal, orphans: orphansTotal },
      drift: { checked: checkedTotal, drifted: driftedTotal, approvalsCreated: approvalsTotal },
      agent,
    })
  }

  // Verify across all orgs in one pass, then run regression safeguards
  // per-org. (Verify must complete before downgrade can find new outcomes.)
  const verified = await verify({})
  const downgrades: Array<{ orgId: string; before: string; after: string; reason: string }> = []
  for (const cfg of enabledConfigs) {
    const dg = await checkRegressionDowngrade({ orgId: cfg.orgId })
    if (dg) downgrades.push(dg)
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    orgs: summary,
    verified,
    downgrades,
  })
}
