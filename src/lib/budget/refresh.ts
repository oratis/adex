import { prisma } from '@/lib/prisma'

/**
 * Recompute Budget.spent for every active Budget in an org from the
 * underlying Report data. Closes a long-standing gap (gap-analysis §3.1):
 * Budget.spent was never written; "how much budget remains today" was a
 * blind spot.
 *
 * Rules:
 *   - daily budgets: spent = sum of Report.spend for the budget's campaign
 *     (or org if campaign-scoped, see below) on **today's** UTC date
 *   - lifetime budgets: spent = sum of Report.spend since Budget.startDate
 *     (or createdAt if startDate is null), bounded at endDate
 *   - org-scope budgets (campaignId=null): aggregate across all the org's
 *     Reports
 *   - we prefer level=campaign Report rows when a campaignId is known so the
 *     number matches campaign-detail page; fall back to level=account
 *
 * Returns counts so callers can log progress.
 */
export async function refreshBudgetSpent(opts: { orgId?: string }): Promise<{
  budgetsTouched: number
}> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)

  const budgets = await prisma.budget.findMany({
    where: opts.orgId ? { orgId: opts.orgId } : {},
    select: {
      id: true,
      orgId: true,
      type: true,
      campaignId: true,
      startDate: true,
      endDate: true,
      createdAt: true,
    },
  })

  let touched = 0
  for (const b of budgets) {
    const isDaily = b.type === 'daily'
    const dateRange = isDaily
      ? { gte: today, lt: tomorrow }
      : {
          gte: b.startDate ?? b.createdAt,
          ...(b.endDate ? { lte: b.endDate } : {}),
        }

    let spent = 0
    if (b.campaignId) {
      // Prefer campaign-level rows. If the campaign has a PlatformLink, sum
      // Report rows tagged with that link; else fall back to the legacy
      // campaignId path (older Reports).
      const link = await prisma.platformLink.findFirst({
        where: {
          orgId: b.orgId,
          entityType: 'campaign',
          localEntityId: b.campaignId,
          status: 'active',
        },
      })
      if (link) {
        const rows = await prisma.report.findMany({
          where: {
            orgId: b.orgId,
            level: 'campaign',
            campaignLinkId: link.id,
            date: dateRange,
          },
          select: { spend: true },
        })
        spent = rows.reduce((s, r) => s + r.spend, 0)
      } else {
        const rows = await prisma.report.findMany({
          where: { orgId: b.orgId, campaignId: b.campaignId, date: dateRange },
          select: { spend: true },
        })
        spent = rows.reduce((s, r) => s + r.spend, 0)
      }
    } else {
      // Org-scope budget — sum account-level Reports across all platforms.
      const rows = await prisma.report.findMany({
        where: { orgId: b.orgId, level: 'account', date: dateRange },
        select: { spend: true },
      })
      spent = rows.reduce((s, r) => s + r.spend, 0)
    }

    await prisma.budget.update({
      where: { id: b.id },
      data: { spent: Number(spent.toFixed(2)) },
    })
    touched++
  }

  return { budgetsTouched: touched }
}
