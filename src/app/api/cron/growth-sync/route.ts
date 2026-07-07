import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { prisma } from '@/lib/prisma'
import { buildCohortSnapshots, type RawEvent } from '@/lib/growth/cohorts'
import { EVENTS, SOURCES, type EventName } from '@/lib/growth/events'
import { resolveInstallAuthority } from '@/lib/growth/kpi-canon'
import { CHANNELS, type Channel } from '@/lib/growth/channels'

/**
 * POST /api/cron/growth-sync
 *
 * Recomputes CohortSnapshot for every org over a rolling 60-day window from
 * their ConversionEvent rows. Idempotent: deletes the window's snapshots and
 * re-inserts, so re-running never double-counts. Auth via X-Cron-Secret.
 *
 * Scheduled daily (Cloud Scheduler). CAC is computed from Report spend,
 * mapped to a channel via PLATFORM_TO_CHANNEL below (bi §6,
 * docs/growth/06-mmp-ingest.md §6) — platforms we can't confidently map to a
 * single pilot channel are excluded and their spend reported separately as
 * `unallocatedSpend` rather than guessed onto some channel.
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §10 (P18)
 */

const WINDOW_DAYS = 60
const KNOWN_EVENTS = new Set<string>(Object.values(EVENTS))

/**
 * Report.platform → growth Channel, for attributing media spend to cohorts.
 * Deliberately conservative and partial: Report is an account-level daily
 * total per ad platform with NO channel/os dimension of its own, so we can
 * only map platforms that map 1:1 onto a single pilot channel. `google` /
 * `meta` / `tiktok` default to their *_web arm (the pilot's deterministic
 * spine) since Report can't disambiguate web vs iOS-SKAN spend either.
 * `adjust` / `appsflyer` are MMPs, not ad channels — their Report rows are
 * legacy MMP-reported totals (docs/growth/06-mmp-ingest.md §0), and mapping
 * them here would double-count spend already attributed to the platform that
 * bought the media. `amazon` / `linkedin` have no corresponding pilot
 * channel constant yet. All of these are left unmapped; their spend is
 * reported as `unallocatedSpend` in the cron summary rather than silently
 * dropped or guessed onto some channel.
 */
const PLATFORM_TO_CHANNEL: Partial<Record<string, Channel>> = {
  google: CHANNELS.PAID_GOOGLE_UAC,
  meta: CHANNELS.PAID_META_WEB,
  tiktok: CHANNELS.PAID_TIKTOK_WEB,
}

export async function POST(req: NextRequest) {
  if (!(await verifyCronAuth(req, 'growth-sync'))) {
    return NextResponse.json({ error: 'Unauthorized — set X-Cron-Secret header' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const orgs = await prisma.organization.findMany({ select: { id: true } })

  const summary: Array<{
    orgId: string
    cohorts: number
    events: number
    installAuthority?: string
    installAuthorityWarning?: string
    unallocatedSpend?: number
  }> = []

  for (const org of orgs) {
    const rows = await prisma.conversionEvent.findMany({
      where: { orgId: org.id, occurredAt: { gte: cutoff } },
      select: { eventName: true, occurredAt: true, userKey: true, channel: true, os: true, agency: true, revenue: true, source: true },
    })

    const events: RawEvent[] = rows
      .filter((r) => KNOWN_EVENTS.has(r.eventName))
      .map((r) => ({
        eventName: r.eventName as EventName,
        occurredAt: r.occurredAt,
        userKey: r.userKey,
        channel: r.channel,
        os: r.os,
        agency: r.agency,
        revenue: r.revenue,
        source: r.source,
      }))

    // Media spend → cohort attribution (bi §6): sum Report.spend in the same
    // window, keyed by `${date}|${channel}` via PLATFORM_TO_CHANNEL. Spend on
    // platforms we can't map to a channel is tallied separately rather than
    // silently dropped or guessed.
    const reportRows = await prisma.report.findMany({
      where: { orgId: org.id, date: { gte: cutoff } },
      select: { date: true, platform: true, spend: true },
    })
    const spendByCohort = new Map<string, number>()
    let unallocatedSpend = 0
    for (const r of reportRows) {
      const channel = PLATFORM_TO_CHANNEL[r.platform]
      if (!channel) {
        unallocatedSpend += r.spend
        continue
      }
      const key = `${r.date.toISOString().slice(0, 10)}|${channel}`
      spendByCohort.set(key, (spendByCohort.get(key) ?? 0) + r.spend)
    }

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

    const cohorts = buildCohortSnapshots(events, {
      installAuthority: installAuthorityResult.authority,
      spendByCohort,
    })

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
          os: c.os,
          agency: c.agency,
          installs: c.installs,
          signups: c.signups,
          activated: c.activated,
          d1Retained: c.d1Retained,
          d7Retained: c.d7Retained,
          trials: c.trials,
          subscribers: c.subscribers,
          revenueToDate: c.revenueToDate,
          revenueD0: c.revenueD0,
          revenueD7: c.revenueD7,
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
      ...(unallocatedSpend > 0 ? { unallocatedSpend } : {}),
    })
  }

  return NextResponse.json({ ok: true, window: `${WINDOW_DAYS}d`, orgs: summary })
}
