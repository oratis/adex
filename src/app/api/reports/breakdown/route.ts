import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { cpc, aggregateCohortWindow, computeFunnelMetrics, type CohortWindowRow } from '@/lib/growth/kpi-canon'
import { isOs } from '@/lib/growth/events'
import { channelToPlatform } from '@/lib/growth/channels'

/**
 * GET /api/reports/breakdown?start&end&os&platform&agency
 *
 * bi §6/§7 — media-delivery detail rows from Report, dimensioned
 * date > os > platform > agency, joined back to the funnel
 * (CohortSnapshot) on that same (date, os, platform, agency) key.
 *
 * The join key's `platform` side comes from `channelToPlatform(channel)`
 * (docs/growth/06-mmp-ingest.md §7) — earned/organic channels have no ad
 * platform and never join. A Report row joins when at least one
 * CohortSnapshot row shares its exact (date, os, platform, agency) key;
 * unmatched rows keep every funnel column `null` rather than a fabricated 0
 * (a row that legitimately joined to zero signups looks identical to one
 * that never joined otherwise — see the `funnelJoin` response field below
 * for the aggregate signal).
 *
 * `funnelJoin` is a RESPONSE-level field (not per-row): 'full' when every
 * report-side group joined, 'partial' when some did, 'none' when none did
 * (including the trivial case of zero report rows). Callers use it to decide
 * whether to show a "funnel pending" banner — a per-row pending marker isn't
 * needed once real numbers are available for the rows that did join.
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

  // Server-side window guard: a request omitting start would otherwise scan
  // every Report row the org has. Default to a rolling window ending at `end`
  // (or now), mirroring growth-sync's WINDOW_DAYS — the UI always sends an
  // explicit range, so this only bounds hand-crafted requests.
  const WINDOW_DAYS = 60
  const effectiveEnd = end ?? new Date()
  const effectiveStart = start ?? new Date(effectiveEnd.getTime() - WINDOW_DAYS * 86_400_000)

  const date: { gte?: Date; lte?: Date } = { gte: effectiveStart }
  if (end) date.lte = end

  const reports = await prisma.report.findMany({
    where: {
      orgId: org.id,
      date,
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

  // Funnel bridge (bi §7): CohortSnapshot rows in the same window, keyed the
  // same way via channelToPlatform. Same start/end/os/agency filters as the
  // Report query above — a coherent join needs both sides looking at the
  // same slice. `platformFilter` has no CohortSnapshot analogue (Report's
  // `platform` is the ad-buying platform; CohortSnapshot has no platform
  // column, only `channel`), so it's intentionally not applied here — the
  // Report side already restricts to that platform, and the join key match
  // takes care of the rest.
  const cohortDate: { gte?: Date; lte?: Date } = {}
  if (start) cohortDate.gte = start
  if (end) cohortDate.lte = end
  const cohorts = await prisma.cohortSnapshot.findMany({
    where: {
      orgId: org.id,
      ...(start || end ? { cohortDate } : {}),
      ...(osFilter ? { os: osFilter } : {}),
      ...(agencyFilter ? { agency: agencyFilter } : {}),
    },
    select: { cohortDate: true, channel: true, os: true, agency: true, installs: true, signups: true, d1Retained: true, d7Retained: true, revenueD0: true, revenueD7: true },
  })

  const cohortsByKey = new Map<string, CohortWindowRow[]>()
  for (const c of cohorts) {
    const platform = channelToPlatform(c.channel)
    if (!platform) continue // earned/organic channels have no ad platform — never join
    const dateKey = c.cohortDate.toISOString().slice(0, 10)
    const key = `${dateKey}|${c.os ?? ''}|${platform}|${c.agency ?? ''}`
    const row: CohortWindowRow = {
      cohortDate: dateKey,
      installs: c.installs,
      signups: c.signups,
      d1Retained: c.d1Retained,
      d7Retained: c.d7Retained,
      revenueD0: c.revenueD0,
      revenueD7: c.revenueD7,
    }
    const arr = cohortsByKey.get(key)
    if (arr) arr.push(row)
    else cohortsByKey.set(key, [row])
  }

  let joinedGroups = 0
  const rows = [...groups.values()]
    .map((g) => {
      const key = `${g.date}|${g.os ?? ''}|${g.platform}|${g.agency ?? ''}`
      const cohortRows = cohortsByKey.get(key)
      const joined = !!cohortRows && cohortRows.length > 0
      if (joined) joinedGroups += 1

      const funnel = joined
        ? (() => {
            const agg = aggregateCohortWindow(cohortRows!)
            const metrics = computeFunnelMetrics({
              spend: g.spend,
              signups: agg.signups,
              d1Retained: agg.d1,
              d1Base: agg.d1Base,
              d7Retained: agg.d7,
              d7Base: agg.d7Base,
              revenueD0: agg.revenueD0,
              revenueD7: agg.revenueD7,
            })
            return { signups: agg.signups, ...metrics }
          })()
        : { signups: null, costPerSignup: null, d1Rate: null, d7Rate: null, d0Roi: null, d7Roi: null }

      return {
        date: g.date,
        os: g.os,
        platform: g.platform,
        agency: g.agency,
        impressions: g.impressions,
        clicks: g.clicks,
        spend: g.spend,
        cpc: cpc(g.spend, g.clicks),
        ...funnel,
      }
    })
    .sort((x, y) => (x.date === y.date ? x.platform.localeCompare(y.platform) : x.date.localeCompare(y.date)))

  const totalGroups = groups.size
  const funnelJoin: 'full' | 'partial' | 'none' =
    totalGroups === 0 || joinedGroups === 0 ? 'none' : joinedGroups === totalGroups ? 'full' : 'partial'

  return NextResponse.json({ hasData: rows.length > 0, funnelJoin, rows })
}
