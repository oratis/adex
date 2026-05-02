import { prisma } from '@/lib/prisma'

/**
 * verify — for every executed Decision in the past 7 days that doesn't yet
 * have an outcome row, compare metrics in the 24h *before* execution vs the
 * 24h *after*. Classify and persist.
 *
 * "Before" baseline uses the campaign-level Report rows. If there's no
 * campaign-level data (e.g. drafts), we fall back to org-level.
 */
export type Classification = 'success' | 'neutral' | 'regression' | 'false_positive' | 'inconclusive'

type MetricSummary = {
  spend: number
  revenue: number
  conversions: number
  impressions: number
  clicks: number
  roas: number
}

function asSummary(rs: { spend: number; revenue: number; conversions: number; impressions: number; clicks: number }[]): MetricSummary {
  const m = rs.reduce(
    (a, r) => ({
      spend: a.spend + r.spend,
      revenue: a.revenue + r.revenue,
      conversions: a.conversions + r.conversions,
      impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks,
    }),
    { spend: 0, revenue: 0, conversions: 0, impressions: 0, clicks: 0 }
  )
  return { ...m, roas: m.spend > 0 ? m.revenue / m.spend : 0 }
}

async function metricsForCampaign(
  campaignLinkId: string,
  windowStart: Date,
  windowEnd: Date
): Promise<MetricSummary> {
  const rs = await prisma.report.findMany({
    where: {
      level: 'campaign',
      campaignLinkId,
      date: { gte: windowStart, lte: windowEnd },
    },
  })
  return asSummary(rs)
}

async function metricsForOrg(
  orgId: string,
  windowStart: Date,
  windowEnd: Date
): Promise<MetricSummary> {
  const rs = await prisma.report.findMany({
    where: {
      orgId,
      level: 'account',
      date: { gte: windowStart, lte: windowEnd },
    },
  })
  return asSummary(rs)
}

function classify(
  before: MetricSummary,
  after: MetricSummary,
  intent: 'pause' | 'resume' | 'budget_change' | 'other'
): Classification {
  switch (intent) {
    case 'pause': {
      // Pausing should reduce spend without losing meaningful revenue.
      if (after.spend < before.spend * 0.5) {
        if (after.revenue >= before.revenue * 0.8) return 'success'
        return 'regression' // revenue cratered
      }
      return 'neutral'
    }
    case 'resume': {
      if (after.revenue > before.revenue && after.roas >= before.roas * 0.9) return 'success'
      if (after.spend > before.spend && after.revenue <= before.revenue * 0.5)
        return 'regression'
      return 'neutral'
    }
    case 'budget_change': {
      if (after.roas >= before.roas * 0.9) return 'success'
      if (after.roas < before.roas * 0.5) return 'regression'
      return 'neutral'
    }
    default:
      return 'neutral'
  }
}

function intentForStep(toolName: string): 'pause' | 'resume' | 'budget_change' | 'other' {
  if (toolName === 'pause_campaign' || toolName === 'pause_ad' || toolName === 'pause_ad_group')
    return 'pause'
  if (toolName === 'resume_campaign') return 'resume'
  if (toolName === 'adjust_daily_budget') return 'budget_change'
  return 'other'
}

export async function verify(opts: { orgId?: string; windowHours?: number } = {}) {
  const windowHours = opts.windowHours ?? 24
  const lookback = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const decisions = await prisma.decision.findMany({
    where: {
      status: 'executed',
      executedAt: {
        gte: lookback,
        lte: new Date(Date.now() - windowHours * 60 * 60 * 1000),
      },
      outcome: null,
      ...(opts.orgId ? { orgId: opts.orgId } : {}),
    },
    include: { steps: true },
    take: 200,
  })

  let processed = 0
  for (const decision of decisions) {
    if (!decision.executedAt) continue
    const before = new Date(decision.executedAt.getTime() - windowHours * 60 * 60 * 1000)
    const after = new Date(decision.executedAt.getTime() + windowHours * 60 * 60 * 1000)

    // Pick the first step that touched a known link. Audit High #11 — also
    // verify the link still exists (it could have been deleted via campaign
    // delete cascading via local Campaign onDelete: Cascade); without this
    // check the metrics queries silently return 0 and we'd misclassify
    // outcomes as success/regression based on baseline-of-0.
    const linkedStep = decision.steps.find((s) => s.platformLinkId)
    let useLink = false
    if (linkedStep?.platformLinkId) {
      const linkExists = await prisma.platformLink.findUnique({
        where: { id: linkedStep.platformLinkId },
        select: { id: true },
      })
      useLink = !!linkExists
    }
    const beforeMetrics = useLink
      ? await metricsForCampaign(linkedStep!.platformLinkId!, before, decision.executedAt)
      : await metricsForOrg(decision.orgId, before, decision.executedAt)
    const afterMetrics = useLink
      ? await metricsForCampaign(linkedStep!.platformLinkId!, decision.executedAt, after)
      : await metricsForOrg(decision.orgId, decision.executedAt, after)

    // If the linked step's PlatformLink was deleted, mark as inconclusive
    // rather than guessing from org-level data (which is too coarse for a
    // single-campaign action).
    let classification: Classification | 'inconclusive'
    if (linkedStep?.platformLinkId && !useLink) {
      classification = 'inconclusive'
    } else {
      const intent = intentForStep(decision.steps[0]?.toolName || 'noop')
      classification = classify(beforeMetrics, afterMetrics, intent)
    }

    await prisma.decisionOutcome.create({
      data: {
        decisionId: decision.id,
        measuredAt: new Date(),
        windowHours,
        metricsBefore: JSON.stringify(beforeMetrics),
        metricsAfter: JSON.stringify(afterMetrics),
        delta: JSON.stringify({
          spend: afterMetrics.spend - beforeMetrics.spend,
          revenue: afterMetrics.revenue - beforeMetrics.revenue,
          roas: afterMetrics.roas - beforeMetrics.roas,
        }),
        classification,
      },
    })
    processed++
  }
  return { processed }
}
