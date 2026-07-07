/**
 * Cohort aggregation (pure) — folds normalized ConversionEvents into
 * per-acquisition-day × channel × os CohortSnapshot rows. The growth-sync cron
 * runs this over a rolling window and persists the output.
 *
 * Acquisition anchor (bi §6, docs/growth/06-mmp-ingest.md §6): a user's cohort
 * = the calendar day of their FIRST signup event, from ANY source — signup is
 * never filtered by installAuthority, because it's our own first-party event,
 * not a duplicated MMP/GA4 install signal. A user with no signup falls back to
 * their first ELIGIBLE install (install candidates ARE still filtered by
 * installAuthority, same as before — that's the single-install-source-
 * authority fix for double-counted installs, decision A). A user with neither
 * a signup nor an eligible install cannot be placed in a cohort and is
 * ignored.
 *
 * Channel/os attribution: once a user is anchored, their channel and os are
 * NOT necessarily read off the anchor event. Install-based MMP attribution
 * (Adjust/AppsFlyer network + device signal) is more reliable than a signup's
 * self-reported UTM, so if the user has ANY eligible install event (same
 * installAuthority filter), its channel/os wins even when the anchor itself
 * is the signup. Only signup-anchored users with no install event at all fall
 * back to the signup's own channel/os (e.g. a pure web signup with no MMP
 * involved).
 *
 * Revenue events from RevenueCat carry no channel of their own — they attach
 * to the user's acquisition channel via userKey. Events with no userKey
 * cannot be placed in a cohort and are ignored here.
 *
 * Retention proxy: presence of an engagement event (first_chat / scene_generated)
 * on cohortDay+N. Documented as a proxy — a dedicated GA4 retention signal can
 * refine it later without changing this contract.
 *
 * revenueD0 / revenueD7 (bi §6): windows of `subscription_activated` revenue
 * only (not renewals) relative to the cohort anchor day — D0 = dayDiff ≤ 0
 * (the anchor day itself; revenue can't legitimately precede acquisition, but
 * the ≤0 bound is the documented, literal spec), D7 = dayDiff ≤ 7 (anchor day
 * through +7 inclusive). These are subsets of `revenueToDate`, which still
 * sums ALL revenue events (including renewals) with no time bound.
 *
 * Single install-source authority (decision A, docs/growth/06-mmp-ingest.md §2):
 * when an org has both GA4 and Adjust wired, `opts.installAuthority` restricts
 * which source's INSTALL events are eligible acquisition/attribution
 * candidates — otherwise the same real install lands twice (once per source,
 * under two different userKey namespaces) and installs double-count. Signup,
 * funnel-deep (first_chat/scene_generated), and revenue events are never
 * filtered by source — Adjust doesn't report those at all, so filtering them
 * would zero out activation/retention for MMP-attributed cohorts.
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §4.1 · docs/growth/06-mmp-ingest.md §6 · kpi-canon.realizedLtv
 */

import { EVENTS, type EventName } from './events'
import { CHANNELS } from './channels'
import { realizedLtv } from './kpi-canon'

export interface RawEvent {
  eventName: EventName
  occurredAt: Date
  userKey: string | null
  channel: string | null
  /** ios | android | web, when known. */
  os?: string | null
  revenue: number
  /** ConversionEvent.source (ga4 | revenuecat | deeplink | adjust | backend). */
  source: string
}

export interface CohortRow {
  cohortDate: string // YYYY-MM-DD (UTC)
  channel: string
  os: string | null
  installs: number
  signups: number
  activated: number
  d1Retained: number
  d7Retained: number
  trials: number
  subscribers: number
  revenueToDate: number
  revenueD0: number
  revenueD7: number
  ltvEstimate: number
  cac: number | null
}

const ENGAGEMENT: Set<EventName> = new Set([EVENTS.FIRST_CHAT, EVENTS.SCENE_GENERATED])

/** UTC calendar day key. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Whole-day difference (UTC) between a cohort day key and an event date. */
function dayDiff(fromKey: string, to: Date): number {
  const from = Date.parse(fromKey + 'T00:00:00.000Z')
  const toDay = Date.parse(dayKey(to) + 'T00:00:00.000Z')
  return Math.round((toDay - from) / 86_400_000)
}

const byTime = (a: RawEvent, b: RawEvent) => a.occurredAt.getTime() - b.occurredAt.getTime()

/**
 * Build cohort rows from a user's full event set. `spendByCohort` optionally
 * supplies media spend keyed by `${cohortDate}|${channel}` (channel-only, not
 * os-qualified — os has no independent spend line yet) to compute CAC.
 * `installAuthority`, if set, restricts which source's INSTALL events are
 * eligible acquisition/attribution candidates — see the module doc comment.
 */
export function buildCohortSnapshots(
  events: RawEvent[],
  opts: { spendByCohort?: Map<string, number>; installAuthority?: string } = {},
): CohortRow[] {
  // 1. Group events by user.
  const byUser = new Map<string, RawEvent[]>()
  for (const e of events) {
    if (!e.userKey) continue
    const arr = byUser.get(e.userKey)
    if (arr) arr.push(e)
    else byUser.set(e.userKey, [e])
  }

  // 2. Reduce each user to a cohort contribution.
  type Acc = Omit<CohortRow, 'cohortDate' | 'channel' | 'os' | 'ltvEstimate' | 'cac'>
  const cohorts = new Map<string, Acc>()
  const keyOf = (cohortDate: string, channel: string, os: string | null) => `${cohortDate}|${channel}|${os ?? ''}`

  for (const userEvents of byUser.values()) {
    const signupEvent = userEvents
      .filter((e) => e.eventName === EVENTS.SIGNUP)
      .sort(byTime)[0]
    const installEvent = userEvents
      .filter((e) => e.eventName === EVENTS.INSTALL && (!opts.installAuthority || e.source === opts.installAuthority))
      .sort(byTime)[0]

    const anchoredBySignup = !!signupEvent
    const anchor = signupEvent ?? installEvent
    if (!anchor) continue // no signup, no eligible install → can't place in a cohort

    const cohortDate = dayKey(anchor.occurredAt)
    // MMP install attribution beats a signup's self-reported UTM, whether or
    // not the install is the anchor itself.
    const attribution = installEvent ?? anchor
    const channel = attribution.channel || CHANNELS.ORGANIC
    const os = attribution.os ?? null

    const key = keyOf(cohortDate, channel, os)
    let acc = cohorts.get(key)
    if (!acc) {
      acc = {
        installs: 0,
        signups: 0,
        activated: 0,
        d1Retained: 0,
        d7Retained: 0,
        trials: 0,
        subscribers: 0,
        revenueToDate: 0,
        revenueD0: 0,
        revenueD7: 0,
      }
      cohorts.set(key, acc)
    }

    if (anchoredBySignup) acc.signups += 1
    else acc.installs += 1

    if (userEvents.some((e) => e.eventName === EVENTS.FIRST_CHAT)) acc.activated += 1
    if (userEvents.some((e) => ENGAGEMENT.has(e.eventName) && dayDiff(cohortDate, e.occurredAt) === 1)) acc.d1Retained += 1
    if (userEvents.some((e) => ENGAGEMENT.has(e.eventName) && dayDiff(cohortDate, e.occurredAt) === 7)) acc.d7Retained += 1
    if (userEvents.some((e) => e.eventName === EVENTS.TRIAL_START)) acc.trials += 1
    if (userEvents.some((e) => e.eventName === EVENTS.SUBSCRIPTION_ACTIVATED)) acc.subscribers += 1
    acc.revenueToDate += userEvents.reduce((s, e) => s + (e.revenue || 0), 0)

    for (const e of userEvents) {
      if (e.eventName !== EVENTS.SUBSCRIPTION_ACTIVATED) continue
      const diff = dayDiff(cohortDate, e.occurredAt)
      if (diff <= 0) acc.revenueD0 += e.revenue || 0
      if (diff <= 7) acc.revenueD7 += e.revenue || 0
    }
  }

  // 3. Finalize: attach LTV + CAC.
  const rows: CohortRow[] = []
  for (const [key, acc] of cohorts) {
    const [cohortDate, channel, osKey] = key.split('|')
    const os = osKey === '' ? null : osKey
    const cohortSize = acc.installs + acc.signups
    const spend = opts.spendByCohort?.get(`${cohortDate}|${channel}`)
    rows.push({
      cohortDate,
      channel,
      os,
      ...acc,
      ltvEstimate: realizedLtv(acc.revenueToDate, cohortSize),
      cac: spend !== undefined && cohortSize > 0 ? spend / cohortSize : null,
    })
  }
  rows.sort((a, b) => {
    if (a.cohortDate !== b.cohortDate) return a.cohortDate.localeCompare(b.cohortDate)
    if (a.channel !== b.channel) return a.channel.localeCompare(b.channel)
    return (a.os ?? '').localeCompare(b.os ?? '')
  })
  return rows
}
