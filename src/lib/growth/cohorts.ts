/**
 * Cohort aggregation (pure) — folds normalized ConversionEvents into
 * per-acquisition-day × channel CohortSnapshot rows. The growth-sync cron runs
 * this over a rolling window and persists the output.
 *
 * A user's cohort = the calendar day and channel of their FIRST acquisition
 * event (install, else signup). Their later events (first_chat=activation,
 * engagement on day+1/+7=retention, trial, subscription, revenue) roll up to
 * that cohort. Revenue events from RevenueCat carry no channel of their own —
 * they attach to the user's acquisition channel via userKey. Events with no
 * userKey cannot be placed in a cohort and are ignored here.
 *
 * Retention proxy: presence of an engagement event (first_chat / scene_generated)
 * on cohortDay+N. Documented as a proxy — a dedicated GA4 retention signal can
 * refine it later without changing this contract.
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §4.1 · kpi-canon.realizedLtv
 */

import { EVENTS, type EventName } from './events'
import { CHANNELS } from './channels'
import { realizedLtv } from './kpi-canon'

export interface RawEvent {
  eventName: EventName
  occurredAt: Date
  userKey: string | null
  channel: string | null
  revenue: number
}

export interface CohortRow {
  cohortDate: string // YYYY-MM-DD (UTC)
  channel: string
  installs: number
  activated: number
  d1Retained: number
  d7Retained: number
  trials: number
  subscribers: number
  revenueToDate: number
  ltvEstimate: number
  cac: number | null
}

const ACQUISITION: Set<EventName> = new Set([EVENTS.INSTALL, EVENTS.SIGNUP])
const ENGAGEMENT: Set<EventName> = new Set([EVENTS.FIRST_CHAT, EVENTS.SCENE_GENERATED])

/** UTC calendar day key. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Whole-day difference (UTC) between two day keys. */
function dayDiff(fromKey: string, to: Date): number {
  const from = Date.parse(fromKey + 'T00:00:00.000Z')
  const toDay = Date.parse(dayKey(to) + 'T00:00:00.000Z')
  return Math.round((toDay - from) / 86_400_000)
}

/**
 * Build cohort rows from a user's full event set. `spendByCohort` optionally
 * supplies media spend keyed by `${cohortDate}|${channel}` to compute CAC.
 */
export function buildCohortSnapshots(
  events: RawEvent[],
  opts: { spendByCohort?: Map<string, number> } = {},
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
  type Acc = Omit<CohortRow, 'cohortDate' | 'channel' | 'ltvEstimate' | 'cac'>
  const cohorts = new Map<string, Acc>()
  const keyOf = (cohortDate: string, channel: string) => `${cohortDate}|${channel}`

  for (const userEvents of byUser.values()) {
    const acquisition = userEvents
      .filter((e) => ACQUISITION.has(e.eventName))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0]
    if (!acquisition) continue // no install/signup → can't place in a cohort

    const cohortDate = dayKey(acquisition.occurredAt)
    const channel = acquisition.channel || CHANNELS.ORGANIC
    const key = keyOf(cohortDate, channel)
    let acc = cohorts.get(key)
    if (!acc) {
      acc = { installs: 0, activated: 0, d1Retained: 0, d7Retained: 0, trials: 0, subscribers: 0, revenueToDate: 0 }
      cohorts.set(key, acc)
    }

    acc.installs += 1
    if (userEvents.some((e) => e.eventName === EVENTS.FIRST_CHAT)) acc.activated += 1
    if (userEvents.some((e) => ENGAGEMENT.has(e.eventName) && dayDiff(cohortDate, e.occurredAt) === 1)) acc.d1Retained += 1
    if (userEvents.some((e) => ENGAGEMENT.has(e.eventName) && dayDiff(cohortDate, e.occurredAt) === 7)) acc.d7Retained += 1
    if (userEvents.some((e) => e.eventName === EVENTS.TRIAL_START)) acc.trials += 1
    if (userEvents.some((e) => e.eventName === EVENTS.SUBSCRIPTION_ACTIVATED)) acc.subscribers += 1
    acc.revenueToDate += userEvents.reduce((s, e) => s + (e.revenue || 0), 0)
  }

  // 3. Finalize: attach LTV + CAC.
  const rows: CohortRow[] = []
  for (const [key, acc] of cohorts) {
    const [cohortDate, channel] = key.split('|')
    const spend = opts.spendByCohort?.get(key)
    rows.push({
      cohortDate,
      channel,
      ...acc,
      ltvEstimate: realizedLtv(acc.revenueToDate, acc.installs),
      cac: spend !== undefined && acc.installs > 0 ? spend / acc.installs : null,
    })
  }
  rows.sort((a, b) => (a.cohortDate === b.cohortDate ? a.channel.localeCompare(b.channel) : a.cohortDate.localeCompare(b.cohortDate)))
  return rows
}
