import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { prisma } from '@/lib/prisma'
import { buildCohortSnapshots, type RawEvent } from '@/lib/growth/cohorts'
import { EVENTS, SOURCES, type EventName } from '@/lib/growth/events'
import { resolveInstallAuthority } from '@/lib/growth/kpi-canon'

/**
 * POST /api/cron/growth-sync
 *
 * Recomputes CohortSnapshot for every org over a rolling 60-day window from
 * their ConversionEvent rows. Idempotent: deletes the window's snapshots and
 * re-inserts, so re-running never double-counts. Auth via X-Cron-Secret.
 *
 * Scheduled daily (Cloud Scheduler). CAC is left null here — per-channel spend
 * attribution (Report → channel) lands with the paid-execution layer (P19).
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §10 (P18)
 */

const WINDOW_DAYS = 60
const KNOWN_EVENTS = new Set<string>(Object.values(EVENTS))

export async function POST(req: NextRequest) {
  if (!(await verifyCronAuth(req, 'growth-sync'))) {
    return NextResponse.json({ error: 'Unauthorized — set X-Cron-Secret header' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const orgs = await prisma.organization.findMany({ select: { id: true } })

  const summary: Array<{ orgId: string; cohorts: number; events: number; installAuthority?: string; installAuthorityWarning?: string }> = []

  for (const org of orgs) {
    const rows = await prisma.conversionEvent.findMany({
      where: { orgId: org.id, occurredAt: { gte: cutoff } },
      select: { eventName: true, occurredAt: true, userKey: true, channel: true, revenue: true, source: true },
    })

    const events: RawEvent[] = rows
      .filter((r) => KNOWN_EVENTS.has(r.eventName))
      .map((r) => ({
        eventName: r.eventName as EventName,
        occurredAt: r.occurredAt,
        userKey: r.userKey,
        channel: r.channel,
        revenue: r.revenue,
        source: r.source,
      }))

    // Install authority (decision A, docs/growth/06-mmp-ingest.md §2): if the
    // org has Adjust wired, Adjust's install events are authoritative and the
    // GA4 install rows for the same window are excluded from cohort placement
    // (see cohorts.ts). The anti-zeroing guard in resolveInstallAuthority falls
    // back to GA4 if Adjust is configured but reported 0 installs this window.
    const hasAdjustAuth = await prisma.platformAuth.findUnique({
      where: { orgId_platform: { orgId: org.id, platform: 'adjust' } },
    }).then((a) => !!a?.isActive).catch(() => false)
    const adjustInstallCount = events.filter((e) => e.eventName === EVENTS.INSTALL && e.source === SOURCES.ADJUST).length
    const ga4InstallCount = events.filter((e) => e.eventName === EVENTS.INSTALL && e.source === SOURCES.GA4).length
    const installAuthorityResult = resolveInstallAuthority({
      hasAdjustAuth,
      adjustInstallCount,
      ga4InstallCount,
    })
    if (installAuthorityResult.warning) {
      console.warn(`[growth-sync] org=${org.id} ${installAuthorityResult.warning}`)
    }

    const cohorts = buildCohortSnapshots(events, { installAuthority: installAuthorityResult.authority })

    // Idempotent recompute: clear the window, then insert fresh.
    await prisma.cohortSnapshot.deleteMany({
      where: { orgId: org.id, cohortDate: { gte: cutoff } },
    })
    if (cohorts.length > 0) {
      await prisma.cohortSnapshot.createMany({
        data: cohorts.map((c) => ({
          orgId: org.id,
          appId: null,
          cohortDate: new Date(c.cohortDate + 'T00:00:00.000Z'),
          channel: c.channel,
          installs: c.installs,
          activated: c.activated,
          d1Retained: c.d1Retained,
          d7Retained: c.d7Retained,
          trials: c.trials,
          subscribers: c.subscribers,
          revenueToDate: c.revenueToDate,
          ltvEstimate: c.ltvEstimate,
          cac: c.cac,
        })),
      })
    }

    summary.push({
      orgId: org.id,
      cohorts: cohorts.length,
      events: events.length,
      installAuthority: installAuthorityResult.authority,
      ...(installAuthorityResult.warning ? { installAuthorityWarning: installAuthorityResult.warning } : {}),
    })
  }

  return NextResponse.json({ ok: true, window: `${WINDOW_DAYS}d`, orgs: summary })
}
