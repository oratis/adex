import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { activationRate, retentionRate, subscriptionRate, realizedLtv, eCACStar, isMatureForRetentionWindow } from '@/lib/growth/kpi-canon'
import { isSkanChannel, type Channel } from '@/lib/growth/channels'
import { evaluateChannel } from '@/lib/growth/pilot-gates'

/**
 * GET /api/growth/channels
 *
 * Per-channel roll-up of CohortSnapshot with the live $5K-pilot gate decision
 * (pilot-gates.evaluateChannel) attached — the channels view's data source.
 * Gate + eCAC* run through the same modules the Agent uses, so the dashboard
 * shows exactly what the automation would decide.
 *
 * Ref: docs/growth/01-5k-pilot-plan.md §P5
 */
export async function GET() {
  let org
  try {
    ({ org } = await requireAuthWithOrg())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const snaps = await prisma.cohortSnapshot.findMany({ where: { orgId: org.id } })

  // `installs` = total cohort size (install- + signup-anchored). d7Base is the
  // maturity-gated D7 denominator (bi §6 D7-dilution fix) — see
  // kpi-canon.isMatureForRetentionWindow.
  type Agg = { installs: number; activated: number; d1: number; d1Base: number; d7: number; d7Base: number; trials: number; subscribers: number; revenue: number; spend: number; hasSpend: boolean }
  const byChannel = new Map<string, Agg>()
  for (const s of snaps) {
    let a = byChannel.get(s.channel)
    if (!a) { a = { installs: 0, activated: 0, d1: 0, d1Base: 0, d7: 0, d7Base: 0, trials: 0, subscribers: 0, revenue: 0, spend: 0, hasSpend: false }; byChannel.set(s.channel, a) }
    const cohortSize = s.installs + s.signups
    const cohortDateKey = s.cohortDate.toISOString().slice(0, 10)
    a.installs += cohortSize
    a.activated += s.activated
    if (isMatureForRetentionWindow(cohortDateKey, 1)) { a.d1 += s.d1Retained; a.d1Base += cohortSize }
    if (isMatureForRetentionWindow(cohortDateKey, 7)) { a.d7 += s.d7Retained; a.d7Base += cohortSize }
    a.trials += s.trials
    a.subscribers += s.subscribers
    a.revenue += s.revenueToDate
    if (s.cac !== null) { a.spend += s.cac * cohortSize; a.hasSpend = true }
  }

  const channels = [...byChannel.entries()]
    .map(([channel, a]) => {
      const actRate = activationRate(a.activated, a.installs)
      const d7Rate = retentionRate(a.d7, a.d7Base)
      const ecac = a.hasSpend ? eCACStar({ spend: a.spend, mediaSubsidyCost: 0, installs: a.installs }) : null
      // Gate runs on real payment signal (subscribers) + funnel proxies.
      const gate = evaluateChannel({
        skanImmature: false,
        spend: a.hasSpend ? a.spend : 0,
        installs: a.installs,
        activationRate: actRate,
        d7: d7Rate,
        mediaSubsidyCost: 0,
        payingUsers: a.subscribers,
      })
      return {
        channel,
        skan: isSkanChannel(channel as Channel),
        installs: a.installs,
        activationRate: actRate,
        d1Rate: retentionRate(a.d1, a.d1Base),
        d7Rate,
        trials: a.trials,
        subscribers: a.subscribers,
        subscriptionRate: subscriptionRate(a.subscribers, a.installs),
        revenue: a.revenue,
        ltv: realizedLtv(a.revenue, a.installs),
        cac: a.hasSpend && a.installs > 0 ? a.spend / a.installs : null,
        ecac,
        gate: { decision: gate.decision, reasons: gate.reasons },
      }
    })
    .sort((x, y) => y.installs - x.installs)

  return NextResponse.json({ hasData: snaps.length > 0, channels })
}
