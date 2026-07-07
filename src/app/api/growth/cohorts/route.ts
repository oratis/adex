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

  const rows = snaps.map((s) => {
    const cohortSize = s.installs + s.signups
    return {
      cohortDate: s.cohortDate.toISOString().slice(0, 10),
      channel: s.channel,
      os: s.os,
      installs: cohortSize,
      activationRate: activationRate(s.activated, cohortSize),
      d1Rate: retentionRate(s.d1Retained, cohortSize),
      d7Rate: retentionRate(s.d7Retained, cohortSize),
      subscribers: s.subscribers,
      subscriptionRate: subscriptionRate(s.subscribers, cohortSize),
      ltv: realizedLtv(s.revenueToDate, cohortSize),
    }
  })

  return NextResponse.json({ hasData: rows.length > 0, rows })
}
