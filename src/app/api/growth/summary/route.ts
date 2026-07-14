import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import {
  retentionRate,
  subscriptionRate,
  costPerSignup,
  costPerPayingUser,
  roi,
  arpu,
  arppu,
  trialToPaidRate,
  isMatureForRetentionWindow,
} from '@/lib/growth/kpi-canon'
import { isChannel, isPaidChannel, type Channel } from '@/lib/growth/channels'
import { isOs } from '@/lib/growth/events'

/**
 * GET /api/growth/summary?start&end&os&source(paid|organic)&channel
 *
 * bi §6 (docs/growth/06-mmp-ingest.md §6) — per-os × paid/organic funnel
 * summary rolled up from CohortSnapshot. `source` buckets a row's channel via
 * `isPaidChannel`; a channel this app doesn't recognize (shouldn't happen,
 * CohortSnapshot.channel is always written from our own taxonomy, but the
 * column has no DB-level enum) is conservatively bucketed as organic rather
 * than thrown away.
 *
 * `trialToPaidRateApprox` is an approximation, not a cohort-matched trial
 * conversion rate: it's subscribers/trials within the SAME filtered window,
 * so a trial started near the window's end and its eventual conversion
 * (which may land after the window closes) are not necessarily the same
 * batch of users. See kpi-canon.trialToPaidRate's own doc comment.
 */
export async function GET(req: NextRequest) {
  let org
  try {
    ;({ org } = await requireAuthWithOrg())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const startParam = url.searchParams.get('start')
  const endParam = url.searchParams.get('end')
  const osFilter = url.searchParams.get('os')
  const sourceFilter = url.searchParams.get('source')
  const channelFilter = url.searchParams.get('channel')

  if (osFilter && !isOs(osFilter)) {
    return NextResponse.json({ error: 'invalid os — must be ios|android|web' }, { status: 400 })
  }
  if (sourceFilter && sourceFilter !== 'paid' && sourceFilter !== 'organic') {
    return NextResponse.json({ error: 'invalid source — must be paid|organic' }, { status: 400 })
  }
  if (channelFilter && !isChannel(channelFilter)) {
    return NextResponse.json({ error: 'invalid channel' }, { status: 400 })
  }
  const start = startParam ? new Date(startParam) : null
  const end = endParam ? new Date(endParam) : null
  if ((startParam && Number.isNaN(start!.getTime())) || (endParam && Number.isNaN(end!.getTime()))) {
    return NextResponse.json({ error: 'invalid start/end date' }, { status: 400 })
  }

  const cohortDate: { gte?: Date; lte?: Date } = {}
  if (start) cohortDate.gte = start
  if (end) cohortDate.lte = end

  const snaps = await prisma.cohortSnapshot.findMany({
    where: {
      orgId: org.id,
      ...(start || end ? { cohortDate } : {}),
      ...(osFilter ? { os: osFilter } : {}),
      ...(channelFilter ? { channel: channelFilter } : {}),
    },
  })

  type Agg = {
    spend: number
    hasSpend: boolean
    signups: number
    cohortSize: number // installs + signups, this bucket's "acquired users"
    activated: number
    d1: number
    d1Base: number
    d7: number
    d7Base: number
    trials: number
    subscribers: number
    revenueD0: number
    revenueD7: number
    revenueToDate: number
  }
  const zero = (): Agg => ({
    spend: 0,
    hasSpend: false,
    signups: 0,
    cohortSize: 0,
    activated: 0,
    d1: 0,
    d1Base: 0,
    d7: 0,
    d7Base: 0,
    trials: 0,
    subscribers: 0,
    revenueD0: 0,
    revenueD7: 0,
    revenueToDate: 0,
  })

  const buckets = new Map<string, Agg>()
  for (const s of snaps) {
    const paid = isChannel(s.channel) ? isPaidChannel(s.channel as Channel) : false
    const sourceBucket: 'paid' | 'organic' = paid ? 'paid' : 'organic'
    if (sourceFilter && sourceFilter !== sourceBucket) continue

    const osBucket = s.os ?? 'unknown'
    const key = `${osBucket}|${sourceBucket}`
    let a = buckets.get(key)
    if (!a) {
      a = zero()
      buckets.set(key, a)
    }

    const cohortSize = s.installs + s.signups
    const cohortDateKey = s.cohortDate.toISOString().slice(0, 10)

    a.cohortSize += cohortSize
    a.signups += s.signups
    a.activated += s.activated
    a.trials += s.trials
    a.subscribers += s.subscribers
    a.revenueD0 += s.revenueD0
    a.revenueD7 += s.revenueD7
    a.revenueToDate += s.revenueToDate
    if (s.cac !== null) {
      a.spend += s.cac * cohortSize
      a.hasSpend = true
    }
    if (isMatureForRetentionWindow(cohortDateKey, 1)) {
      a.d1 += s.d1Retained
      a.d1Base += cohortSize
    }
    if (isMatureForRetentionWindow(cohortDateKey, 7)) {
      a.d7 += s.d7Retained
      a.d7Base += cohortSize
    }
  }

  const rows = [...buckets.entries()]
    .map(([key, a]) => {
      const [os, source] = key.split('|')
      return {
        os,
        source,
        spend: a.hasSpend ? a.spend : null,
        signups: a.signups,
        costPerSignup: a.hasSpend ? costPerSignup(a.spend, a.signups) : null,
        d1Rate: retentionRate(a.d1, a.d1Base),
        d7Rate: retentionRate(a.d7, a.d7Base),
        d0Roi: a.hasSpend ? roi(a.revenueD0, a.spend) : null,
        d7Roi: a.hasSpend ? roi(a.revenueD7, a.spend) : null,
        subscriptionRate: subscriptionRate(a.subscribers, a.cohortSize),
        arpu7d: arpu(a.revenueD7, a.cohortSize),
        arppu7d: arppu(a.revenueD7, a.subscribers),
        trialToPaidRateApprox: trialToPaidRate(a.subscribers, a.trials),
        trials: a.trials,
        subscribers: a.subscribers,
        costPerPayingUser: a.hasSpend ? costPerPayingUser(a.spend, a.subscribers) : null,
        revenueD0: a.revenueD0,
        revenueD7: a.revenueD7,
        // Lifetime-to-computedAt revenue of cohorts anchored in the range. For
        // ranges ending today this equals "range revenue"; for historical
        // ranges it includes revenue earned after the range end — an arbitrary
        // event-window aggregation over ConversionEvent is future work.
        revenueToDate: a.revenueToDate,
      }
    })
    .sort((x, y) => (x.os === y.os ? x.source.localeCompare(y.source) : x.os.localeCompare(y.os)))

  return NextResponse.json({ hasData: rows.length > 0, rows })
}
