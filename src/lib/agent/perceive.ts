import { prisma } from '@/lib/prisma'
import type { CampaignSummary, PerceiveSnapshot, Severity } from './types'

/**
 * Build the "facts" snapshot the LLM will plan against.
 *
 * Sources:
 *   - Campaign rows (org-scoped, status active|paused) — limit 100
 *   - PlatformLink rows for those campaigns (entityType=campaign)
 *   - Report level=campaign for those links (last 7d)
 *   - The most recent CampaignSnapshot per link for budget / status
 *   - The 10 most recent Decisions (with outcome classification if any) for
 *     short-horizon learning
 *
 * Audit High #7: rewritten from per-campaign N+1 (~3 queries × 100 = 300
 * round-trips) to 5 batched queries.
 *
 * Audit Low #31: caps below are intentional. The agent can only reason
 * over what fits in the prompt's context window; if you have >100 active
 * campaigns the agent must be sharded by ad account or by tag. Raising
 * these without rebuilding the prompt schema will silently truncate.
 */
const PERCEIVE_CAMPAIGN_LIMIT = 100
const PERCEIVE_RECENT_DECISIONS = 10

export async function perceive(orgId: string): Promise<PerceiveSnapshot> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const campaigns = await prisma.campaign.findMany({
    where: { orgId, status: { in: ['active', 'paused'] } },
    take: PERCEIVE_CAMPAIGN_LIMIT,
    orderBy: { updatedAt: 'desc' },
  })

  const campaignIds = campaigns.map((c) => c.id)

  // Single query: all PlatformLinks for these campaigns
  const links = campaignIds.length
    ? await prisma.platformLink.findMany({
        where: {
          orgId,
          entityType: 'campaign',
          localEntityId: { in: campaignIds },
          status: 'active',
        },
      })
    : []
  const linkByCampaignId = new Map(links.map((l) => [l.localEntityId, l]))
  const linkIds = links.map((l) => l.id)

  // Single query: all Reports for those links in the 7d window
  type ReportRow = {
    campaignLinkId: string | null
    impressions: number
    clicks: number
    spend: number
    conversions: number
    revenue: number
    date: Date
  }
  const reports: ReportRow[] = linkIds.length
    ? await prisma.report.findMany({
        where: {
          orgId,
          level: 'campaign',
          campaignLinkId: { in: linkIds },
          date: { gte: sevenDaysAgo },
        },
        select: {
          campaignLinkId: true,
          impressions: true,
          clicks: true,
          spend: true,
          conversions: true,
          revenue: true,
          date: true,
        },
      })
    : []
  const reportsByLinkId = new Map<string, ReportRow[]>()
  for (const r of reports) {
    if (!r.campaignLinkId) continue
    const arr = reportsByLinkId.get(r.campaignLinkId) || []
    arr.push(r)
    reportsByLinkId.set(r.campaignLinkId, arr)
  }

  // Most recent snapshot per link. Prisma doesn't expose DISTINCT ON, so
  // fetch a generous slack of rows newest-first and keep the first per link.
  const snapshots = linkIds.length
    ? await prisma.campaignSnapshot.findMany({
        where: { platformLinkId: { in: linkIds } },
        orderBy: { capturedAt: 'desc' },
        take: linkIds.length * 5,
      })
    : []
  const latestSnapshotByLinkId = new Map<string, (typeof snapshots)[number]>()
  for (const s of snapshots) {
    if (!latestSnapshotByLinkId.has(s.platformLinkId)) {
      latestSnapshotByLinkId.set(s.platformLinkId, s)
    }
  }

  const sum = (
    rs: { impressions: number; clicks: number; spend: number; conversions: number; revenue: number }[]
  ) =>
    rs.reduce(
      (a, r) => ({
        impressions: a.impressions + r.impressions,
        clicks: a.clicks + r.clicks,
        spend: a.spend + r.spend,
        conversions: a.conversions + r.conversions,
        revenue: a.revenue + r.revenue,
      }),
      { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 }
    )

  const summaries: CampaignSummary[] = []
  for (const c of campaigns) {
    const link = linkByCampaignId.get(c.id)
    const linkReports = link ? reportsByLinkId.get(link.id) || [] : []
    const reports1d = linkReports.filter((r) => r.date >= oneDayAgo)
    const m7 = sum(linkReports)
    const m1 = sum(reports1d)
    const ctr = m7.impressions > 0 ? (m7.clicks / m7.impressions) * 100 : 0
    const roas7 = m7.spend > 0 ? m7.revenue / m7.spend : 0
    const roas1 = m1.spend > 0 ? m1.revenue / m1.spend : 0
    const lastSnap = link ? latestSnapshotByLinkId.get(link.id) : null

    summaries.push({
      id: c.id,
      name: c.name,
      platform: c.platform,
      desiredStatus: c.desiredStatus,
      syncedStatus: c.syncedStatus,
      managedByAgent: c.managedByAgent,
      metrics7d: { ...m7, ctr, roas: roas7 },
      metrics1d: { ...m1, roas: roas1 },
      platformCampaignId: link?.platformEntityId || c.platformCampaignId || null,
      dailyBudget: lastSnap?.dailyBudget ?? null,
    })
  }

  // Two more queries (parallel)
  const [recentDecisions, guardrails] = await Promise.all([
    prisma.decision.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: PERCEIVE_RECENT_DECISIONS,
      include: { outcome: true },
    }),
    prisma.guardrail.findMany({ where: { orgId, isActive: true }, take: 50 }),
  ])

  const guardrailHints = guardrails.map(
    (g) => `[${g.scope}${g.scopeId ? `:${g.scopeId}` : ''}] ${g.rule}=${g.config}`
  )

  return {
    orgId,
    takenAt: new Date().toISOString(),
    campaigns: summaries,
    recentDecisions: recentDecisions.map((d) => ({
      id: d.id,
      rationale: d.rationale,
      severity: d.severity as Severity,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
      classification: d.outcome?.classification ?? null,
    })),
    guardrailHints,
  }
}
