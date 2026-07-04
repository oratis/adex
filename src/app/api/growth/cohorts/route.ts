import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { activationRate, retentionRate, subscriptionRate, realizedLtv } from '@/lib/growth/kpi-canon'

/**
 * GET /api/growth/cohorts
 *
 * Raw per-acquisition-day × channel cohort rows (most recent first) with rates
 * computed via kpi-canon — the cohort retention/LTV table's data source.
 */
export async function GET() {
  let org
  try {
    ({ org } = await requireAuthWithOrg())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const snaps = await prisma.cohortSnapshot.findMany({
    where: { orgId: org.id },
    orderBy: [{ cohortDate: 'desc' }, { installs: 'desc' }],
    take: 200,
  })

  const rows = snaps.map((s) => ({
    cohortDate: s.cohortDate.toISOString().slice(0, 10),
    channel: s.channel,
    installs: s.installs,
    activationRate: activationRate(s.activated, s.installs),
    d1Rate: retentionRate(s.d1Retained, s.installs),
    d7Rate: retentionRate(s.d7Retained, s.installs),
    subscribers: s.subscribers,
    subscriptionRate: subscriptionRate(s.subscribers, s.installs),
    ltv: realizedLtv(s.revenueToDate, s.installs),
  }))

  return NextResponse.json({ hasData: rows.length > 0, rows })
}
