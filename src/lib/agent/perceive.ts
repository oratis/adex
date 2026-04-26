import { prisma } from '@/lib/prisma'
import type { CampaignSummary, PerceiveSnapshot, Severity } from './types'

/**
 * Build the "facts" snapshot the LLM will plan against.
 *
 * Sources:
 *   - Campaign rows (org-scoped, status active|paused)
 *   - Report level=campaign (last 7d) joined via PlatformLink
 *   - The most recent CampaignSnapshot per campaign for budget / status
 *   - The 10 most recent Decisions (with outcome classification if any) for
 *     short-horizon learning
 */
export async function perceive(orgId: string): Promise<PerceiveSnapshot> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const campaigns = await prisma.campaign.findMany({
    where: {
      orgId,
      status: { in: ['active', 'paused'] },
    },
    take: 100,
    orderBy: { updatedAt: 'desc' },
  })

  const summaries: CampaignSummary[] = []
  for (const c of campaigns) {
    const link = await prisma.platformLink.findFirst({
      where: { orgId, entityType: 'campaign', localEntityId: c.id, status: 'active' },
    })

    const reports7d = link
      ? await prisma.report.findMany({
          where: {
            orgId,
            level: 'campaign',
            campaignLinkId: link.id,
            date: { gte: sevenDaysAgo },
          },
        })
      : []
    const reports1d = reports7d.filter((r) => r.date >= oneDayAgo)

    const sum = (rs: typeof reports7d) =>
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
    const m7 = sum(reports7d)
    const m1 = sum(reports1d)
    const ctr = m7.impressions > 0 ? (m7.clicks / m7.impressions) * 100 : 0
    const roas7 = m7.spend > 0 ? m7.revenue / m7.spend : 0
    const roas1 = m1.spend > 0 ? m1.revenue / m1.spend : 0

    const lastSnap = link
      ? await prisma.campaignSnapshot.findFirst({
          where: { platformLinkId: link.id },
          orderBy: { capturedAt: 'desc' },
        })
      : null

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

  const recentDecisions = await prisma.decision.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { outcome: true },
  })

  const guardrails = await prisma.guardrail.findMany({
    where: { orgId, isActive: true },
    take: 50,
  })
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
