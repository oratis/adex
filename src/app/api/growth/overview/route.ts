import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { activationRate, retentionRate, subscriptionRate, realizedLtv, isMatureForRetentionWindow } from '@/lib/growth/kpi-canon'

/**
 * GET /api/growth/overview
 *
 * The /growth dashboard's data source: the org's CohortSnapshot rows folded
 * into a funnel total + per-channel breakdown. All rates come from kpi-canon so
 * the dashboard, reports, and Agent read identical numbers.
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §8
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
    orderBy: { cohortDate: 'desc' },
  })

  // `installs` here means total cohort size (install-anchored + signup-
  // anchored users) — see kpi-canon retentionRate doc comment. d1Base/d7Base
  // are separate, maturity-gated denominators (bi §6 D7-dilution fix): a
  // cohort whose cohortDate+N hasn't happened yet is excluded from BOTH the
  // numerator and denominator of that D_N rate, not counted as "not retained".
  type Agg = {
    installs: number
    activated: number
    d1: number
    d1Base: number
    d7: number
    d7Base: number
    trials: number
    subscribers: number
    revenue: number
  }
  const zero = (): Agg => ({ installs: 0, activated: 0, d1: 0, d1Base: 0, d7: 0, d7Base: 0, trials: 0, subscribers: 0, revenue: 0 })
  const add = (a: Agg, s: (typeof snaps)[number]) => {
    const cohortSize = s.installs + s.signups
    const cohortDateKey = s.cohortDate.toISOString().slice(0, 10)
    a.installs += cohortSize
    a.activated += s.activated
    if (isMatureForRetentionWindow(cohortDateKey, 1)) {
      a.d1 += s.d1Retained
      a.d1Base += cohortSize
    }
    if (isMatureForRetentionWindow(cohortDateKey, 7)) {
      a.d7 += s.d7Retained
      a.d7Base += cohortSize
    }
    a.trials += s.trials
    a.subscribers += s.subscribers
    a.revenue += s.revenueToDate
  }

  const total = zero()
  const byChannel = new Map<string, Agg & { spend: number; hasSpend: boolean }>()
  let latest: Date | null = null

  for (const s of snaps) {
    add(total, s)
    let c = byChannel.get(s.channel)
    if (!c) {
      c = { ...zero(), spend: 0, hasSpend: false }
      byChannel.set(s.channel, c)
    }
    add(c, s)
    if (s.cac !== null) {
      c.spend += s.cac * (s.installs + s.signups)
      c.hasSpend = true
    }
    if (!latest || s.computedAt > latest) latest = s.computedAt
  }

  const shape = (a: Agg) => ({
    installs: a.installs,
    activated: a.activated,
    activationRate: activationRate(a.activated, a.installs),
    d1Rate: retentionRate(a.d1, a.d1Base),
    d7Rate: retentionRate(a.d7, a.d7Base),
    trials: a.trials,
    subscribers: a.subscribers,
    subscriptionRate: subscriptionRate(a.subscribers, a.installs),
    revenue: a.revenue,
    ltv: realizedLtv(a.revenue, a.installs),
  })

  const channels = [...byChannel.entries()]
    .map(([channel, a]) => ({
      channel,
      ...shape(a),
      cac: a.hasSpend && a.installs > 0 ? a.spend / a.installs : null,
    }))
    .sort((x, y) => y.installs - x.installs)

  return NextResponse.json({
    hasData: snaps.length > 0,
    funnel: shape(total),
    channels,
    updatedAt: latest ? latest.toISOString() : null,
  })
}
