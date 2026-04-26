import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { pruneOldSnapshots } from '@/lib/sync/snapshot'

/**
 * POST /api/cron/agent-retention
 *
 * Daily retention pass per docs/agent/04-data-model.md §4:
 *   - Report level=ad      → keep 90 days
 *   - Report level=adgroup → keep 90 days
 *   - Report level=campaign → keep 13 months
 *   - Report level=account  → keep forever
 *   - CampaignSnapshot     → 30 days dense + thin to 1/day for the next 11 months
 *   - PromptRun            → keep 90 days dense
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
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const thirteenMonthsAgo = new Date(Date.now() - 13 * 30 * 24 * 60 * 60 * 1000)

  const adReports = await prisma.report.deleteMany({
    where: { level: { in: ['ad', 'adgroup'] }, date: { lt: ninetyDaysAgo } },
  })
  const campaignReports = await prisma.report.deleteMany({
    where: { level: 'campaign', date: { lt: thirteenMonthsAgo } },
  })
  const promptRuns = await prisma.promptRun.deleteMany({
    where: { createdAt: { lt: ninetyDaysAgo } },
  })

  // Snapshot thinning runs per-org so the dedupe map stays bounded.
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  let snapshotsThinned = 0
  for (const org of orgs) {
    try {
      const r = await pruneOldSnapshots(org.id)
      snapshotsThinned += r.thinned
    } catch (err) {
      console.error(`[cron/agent-retention] snapshot prune failed for org ${org.id}:`, err)
    }
  }

  return NextResponse.json({
    ok: true,
    deleted: {
      reports_ad_adgroup: adReports.count,
      reports_campaign: campaignReports.count,
      prompt_runs: promptRuns.count,
      snapshots_thinned: snapshotsThinned,
    },
  })
}
