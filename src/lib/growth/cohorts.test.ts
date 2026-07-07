import { describe, it, expect } from 'vitest'
import { buildCohortSnapshots, dayKey, type RawEvent } from './cohorts'
import { EVENTS } from './events'
import { CHANNELS } from './channels'

const D = (iso: string) => new Date(iso)

function ev(p: Partial<RawEvent> & Pick<RawEvent, 'eventName' | 'occurredAt'>): RawEvent {
  return { userKey: 'u1', channel: null, os: null, revenue: 0, source: 'ga4', ...p }
}

describe('dayKey', () => {
  it('is a UTC calendar day', () => {
    expect(dayKey(D('2026-07-04T23:30:00Z'))).toBe('2026-07-04')
  })
})

describe('buildCohortSnapshots', () => {
  it('places a user in the cohort of their first acquisition event', () => {
    const rows = buildCohortSnapshots([
      ev({ userKey: 'a', eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T10:00:00Z'), channel: CHANNELS.PAID_META_WEB }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ cohortDate: '2026-07-01', channel: CHANNELS.PAID_META_WEB, installs: 1 })
  })

  it('defaults channel to organic when the acquisition event has none', () => {
    const rows = buildCohortSnapshots([
      ev({ userKey: 'a', eventName: EVENTS.SIGNUP, occurredAt: D('2026-07-01T10:00:00Z') }),
    ])
    expect(rows[0].channel).toBe(CHANNELS.ORGANIC)
  })

  it('counts activation, D1/D7 retention, trial, subscriber, revenue for one user', () => {
    const base = 'u'
    const rows = buildCohortSnapshots([
      ev({ userKey: base, eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T08:00:00Z'), channel: CHANNELS.PAID_ASA }),
      ev({ userKey: base, eventName: EVENTS.FIRST_CHAT, occurredAt: D('2026-07-01T09:00:00Z') }),
      ev({ userKey: base, eventName: EVENTS.SCENE_GENERATED, occurredAt: D('2026-07-02T09:00:00Z') }), // D1
      ev({ userKey: base, eventName: EVENTS.FIRST_CHAT, occurredAt: D('2026-07-08T09:00:00Z') }), // D7
      ev({ userKey: base, eventName: EVENTS.TRIAL_START, occurredAt: D('2026-07-03T09:00:00Z') }),
      ev({ userKey: base, eventName: EVENTS.SUBSCRIPTION_ACTIVATED, occurredAt: D('2026-07-06T09:00:00Z'), revenue: 9.9 }),
    ])
    expect(rows[0]).toMatchObject({
      installs: 1, activated: 1, d1Retained: 1, d7Retained: 1, trials: 1, subscribers: 1, revenueToDate: 9.9,
    })
    expect(rows[0].ltvEstimate).toBeCloseTo(9.9) // realized: 9.9 / 1 install
  })

  it('attributes RC revenue (channel-less) to the acquisition channel via userKey', () => {
    const rows = buildCohortSnapshots([
      ev({ userKey: 'a', eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T08:00:00Z'), channel: CHANNELS.PAID_TIKTOK_WEB }),
      ev({ userKey: 'a', eventName: EVENTS.SUBSCRIPTION_ACTIVATED, occurredAt: D('2026-07-05T08:00:00Z'), channel: null, revenue: 9.9 }),
    ])
    expect(rows[0].channel).toBe(CHANNELS.PAID_TIKTOK_WEB)
    expect(rows[0].revenueToDate).toBeCloseTo(9.9)
    expect(rows[0].subscribers).toBe(1)
  })

  it('ignores events with no userKey and users with no acquisition event', () => {
    const rows = buildCohortSnapshots([
      ev({ userKey: null, eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T08:00:00Z'), channel: CHANNELS.PAID_ASA }),
      ev({ userKey: 'orphan', eventName: EVENTS.SUBSCRIPTION_ACTIVATED, occurredAt: D('2026-07-05T08:00:00Z'), revenue: 9.9 }),
    ])
    expect(rows).toHaveLength(0)
  })

  it('separates two channels acquired on the same day', () => {
    const rows = buildCohortSnapshots([
      ev({ userKey: 'a', eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T08:00:00Z'), channel: CHANNELS.PAID_META_WEB }),
      ev({ userKey: 'b', eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T09:00:00Z'), channel: CHANNELS.PAID_ASA }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.channel).sort()).toEqual([CHANNELS.PAID_ASA, CHANNELS.PAID_META_WEB].sort())
  })

  it('computes CAC from supplied spend, else null', () => {
    const events = [
      ev({ userKey: 'a', eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T08:00:00Z'), channel: CHANNELS.PAID_ASA }),
      ev({ userKey: 'b', eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T09:00:00Z'), channel: CHANNELS.PAID_ASA }),
    ]
    const spend = new Map([[`2026-07-01|${CHANNELS.PAID_ASA}`, 20]])
    const rows = buildCohortSnapshots(events, { spendByCohort: spend })
    expect(rows[0].cac).toBeCloseTo(10) // $20 / 2 installs
    expect(buildCohortSnapshots(events)[0].cac).toBeNull()
  })

  it('single install-source authority: same real install reported by GA4 + Adjust under different userKey namespaces does not double-count (decision A)', () => {
    const events: RawEvent[] = [
      // Same physical device/user, but GA4 and Adjust can't be joined (decision B) —
      // they land as two distinct userKeys.
      ev({
        userKey: 'ga4-pseudo-1',
        eventName: EVENTS.INSTALL,
        occurredAt: D('2026-07-01T08:00:00Z'),
        channel: CHANNELS.ORGANIC,
        source: 'ga4',
      }),
      ev({
        userKey: 'adjust:abc123',
        eventName: EVENTS.INSTALL,
        occurredAt: D('2026-07-01T08:05:00Z'),
        channel: CHANNELS.PAID_ASA,
        source: 'adjust',
      }),
    ]
    // Without an authority, both userKeys place a cohort row each — the hole.
    expect(buildCohortSnapshots(events).reduce((s, r) => s + r.installs, 0)).toBe(2)

    // With Adjust as install authority, the GA4 install is excluded from
    // acquisition placement (that userKey has no other acquisition event, so
    // it drops out entirely) — only the Adjust-attributed install counts.
    const rows = buildCohortSnapshots(events, { installAuthority: 'adjust' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ installs: 1, channel: CHANNELS.PAID_ASA })
  })

  it('bi §6: signup anchors the cohort even when installAuthority would have excluded it as install-source noise', () => {
    // A GA4 signup — installAuthority='adjust' would exclude a GA4 INSTALL,
    // but signup is never authority-filtered.
    const rows = buildCohortSnapshots(
      [ev({ userKey: 'a', eventName: EVENTS.SIGNUP, occurredAt: D('2026-07-01T10:00:00Z'), source: 'ga4', channel: CHANNELS.ORGANIC })],
      { installAuthority: 'adjust' },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ cohortDate: '2026-07-01', signups: 1, installs: 0 })
  })

  it('bi §6: install-based MMP attribution overrides the signup event\'s own channel', () => {
    const rows = buildCohortSnapshots([
      ev({ userKey: 'a', eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T08:00:00Z'), channel: CHANNELS.PAID_ASA, source: 'adjust' }),
      ev({ userKey: 'a', eventName: EVENTS.SIGNUP, occurredAt: D('2026-07-01T10:00:00Z'), channel: CHANNELS.ORGANIC, source: 'ga4' }),
    ])
    expect(rows).toHaveLength(1)
    // Anchored on the signup day, but channel comes from the install.
    expect(rows[0]).toMatchObject({ cohortDate: '2026-07-01', channel: CHANNELS.PAID_ASA, signups: 1, installs: 0 })
  })

  it('bi §6: a pure web signup with no install event falls back to its own channel/os', () => {
    const rows = buildCohortSnapshots([
      ev({ userKey: 'a', eventName: EVENTS.SIGNUP, occurredAt: D('2026-07-01T10:00:00Z'), channel: CHANNELS.PAID_META_WEB, os: 'web' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ channel: CHANNELS.PAID_META_WEB, os: 'web', signups: 1, installs: 0 })
  })

  it('bi §6: os groups separately even for the same date/channel', () => {
    const rows = buildCohortSnapshots([
      ev({ userKey: 'a', eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T08:00:00Z'), channel: CHANNELS.PAID_ASA, os: 'ios' }),
      ev({ userKey: 'b', eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T09:00:00Z'), channel: CHANNELS.PAID_ASA, os: 'android' }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.os).sort()).toEqual(['android', 'ios'])
  })

  it('bi §6: revenueD0/revenueD7 window boundaries around the cohort anchor day', () => {
    const rows = buildCohortSnapshots([
      ev({ userKey: 'a', eventName: EVENTS.INSTALL, occurredAt: D('2026-07-01T08:00:00Z'), channel: CHANNELS.PAID_ASA }),
      // D0: same calendar day as the anchor.
      ev({ userKey: 'a', eventName: EVENTS.SUBSCRIPTION_ACTIVATED, occurredAt: D('2026-07-01T20:00:00Z'), revenue: 5 }),
      // Within the D7 window (cohortDate + 7) but after D0.
      ev({ userKey: 'a', eventName: EVENTS.SUBSCRIPTION_ACTIVATED, occurredAt: D('2026-07-08T00:00:00Z'), revenue: 3 }),
      // Outside the D7 window (cohortDate + 8).
      ev({ userKey: 'a', eventName: EVENTS.SUBSCRIPTION_ACTIVATED, occurredAt: D('2026-07-09T00:00:00Z'), revenue: 7 }),
    ])
    expect(rows[0].revenueD0).toBeCloseTo(5)
    expect(rows[0].revenueD7).toBeCloseTo(8) // 5 + 3, not the 7 on day+8
    expect(rows[0].revenueToDate).toBeCloseTo(15) // unbounded total includes all three
  })

  it('installAuthority never filters funnel-deep/revenue events, only acquisition events', () => {
    const rows = buildCohortSnapshots(
      [
        ev({
          userKey: 'adjust:abc123',
          eventName: EVENTS.INSTALL,
          occurredAt: D('2026-07-01T08:00:00Z'),
          channel: CHANNELS.PAID_ASA,
          source: 'adjust',
        }),
        // Adjust doesn't report first_chat — it arrives from GA4, must still count.
        ev({
          userKey: 'adjust:abc123',
          eventName: EVENTS.FIRST_CHAT,
          occurredAt: D('2026-07-01T09:00:00Z'),
          source: 'ga4',
        }),
      ],
      { installAuthority: 'adjust' },
    )
    expect(rows[0]).toMatchObject({ installs: 1, activated: 1 })
  })
})
