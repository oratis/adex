import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { cpc } from '@/lib/growth/kpi-canon'
import { isOs } from '@/lib/growth/events'

/**
 * GET /api/reports/breakdown?start&end&os&platform&agency
 *
 * bi §6 — media-delivery detail rows from Report, dimensioned
 * date > os > platform > agency. This is the "what did we buy" side; the
 * funnel columns (signups/subscribers/etc from CohortSnapshot) are NOT joined
 * in yet — Report carries no channel/cohort key to bridge the two tables on
 * (docs/growth/06-mmp-ingest.md §6 notes this as a follow-up, not in scope
 * here). Every row returns `funnelJoin: 'pending'` and null funnel fields so
 * callers don't mistake "not joined" for "joined, zero".
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
  const platformFilter = url.searchParams.get('platform')
  const agencyFilter = url.searchParams.get('agency')

  if (osFilter && !isOs(osFilter)) {
    return NextResponse.json({ error: 'invalid os — must be ios|android|web' }, { status: 400 })
  }
  const start = startParam ? new Date(startParam) : null
  const end = endParam ? new Date(endParam) : null
  if ((startParam && Number.isNaN(start!.getTime())) || (endParam && Number.isNaN(end!.getTime()))) {
    return NextResponse.json({ error: 'invalid start/end date' }, { status: 400 })
  }

  const date: { gte?: Date; lte?: Date } = {}
  if (start) date.gte = start
  if (end) date.lte = end

  const reports = await prisma.report.findMany({
    where: {
      orgId: org.id,
      ...(start || end ? { date } : {}),
      ...(osFilter ? { os: osFilter } : {}),
      ...(platformFilter ? { platform: platformFilter } : {}),
      ...(agencyFilter ? { agency: agencyFilter } : {}),
    },
    select: { date: true, os: true, platform: true, agency: true, impressions: true, clicks: true, spend: true },
  })

  type Agg = { impressions: number; clicks: number; spend: number }
  const groups = new Map<string, Agg & { date: string; os: string | null; platform: string; agency: string | null }>()
  for (const r of reports) {
    const dateKey = r.date.toISOString().slice(0, 10)
    const key = `${dateKey}|${r.os ?? ''}|${r.platform}|${r.agency ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = { date: dateKey, os: r.os, platform: r.platform, agency: r.agency, impressions: 0, clicks: 0, spend: 0 }
      groups.set(key, g)
    }
    g.impressions += r.impressions
    g.clicks += r.clicks
    g.spend += r.spend
  }

  const rows = [...groups.values()]
    .map((g) => ({
      date: g.date,
      os: g.os,
      platform: g.platform,
      agency: g.agency,
      impressions: g.impressions,
      clicks: g.clicks,
      spend: g.spend,
      cpc: cpc(g.spend, g.clicks),
      // Funnel bridge not implemented this phase — see doc comment above.
      funnelSignups: null,
      funnelSubscribers: null,
      funnelJoin: 'pending' as const,
    }))
    .sort((x, y) => (x.date === y.date ? x.platform.localeCompare(y.platform) : x.date.localeCompare(y.date)))

  return NextResponse.json({ hasData: rows.length > 0, rows })
}
