import { describe, it, expect } from 'vitest'
import { parseIncomingEvent, parseIncomingEvents } from './ingest-parse'
import { EVENTS, SOURCES } from './events'
import { CHANNELS } from './channels'

const at = 1_700_000_000_000

describe('parseIncomingEvent', () => {
  it('accepts a valid canonical event and resolves channel from utm', () => {
    const r = parseIncomingEvent({ source: 'ga4', eventName: 'install', occurredAt: at, userKey: 'u', utmSource: 'adex_asa' })
    expect(r).toMatchObject({ source: SOURCES.GA4, eventName: EVENTS.INSTALL, userKey: 'u', channel: CHANNELS.PAID_ASA })
  })
  it('honors an explicit valid channel over utm', () => {
    const r = parseIncomingEvent({ source: 'ga4', eventName: 'install', occurredAt: at, channel: 'kol' })
    expect(r?.channel).toBe(CHANNELS.KOL)
  })
  it('accepts ISO timestamps', () => {
    const r = parseIncomingEvent({ source: 'ga4', eventName: 'signup', occurredAt: '2026-07-04T00:00:00.000Z' })
    expect(r?.occurredAt.toISOString()).toBe('2026-07-04T00:00:00.000Z')
  })
  it('rejects unknown event names and sources', () => {
    expect(parseIncomingEvent({ source: 'ga4', eventName: 'not_an_event', occurredAt: at })).toBeNull()
    expect(parseIncomingEvent({ source: 'mystery', eventName: 'install', occurredAt: at })).toBeNull()
  })
  it('rejects missing/invalid timestamp and non-objects', () => {
    expect(parseIncomingEvent({ source: 'ga4', eventName: 'install' })).toBeNull()
    expect(parseIncomingEvent(null)).toBeNull()
  })
})

describe('parseIncomingEvents', () => {
  it('parses an { events: [...] } envelope and drops invalid entries', () => {
    const out = parseIncomingEvents({
      events: [
        { source: 'ga4', eventName: 'install', occurredAt: at },
        { source: 'ga4', eventName: 'bogus', occurredAt: at },
        { source: 'revenuecat', eventName: 'renewal', occurredAt: at, revenue: 9.9 },
      ],
    })
    expect(out).toHaveLength(2)
    expect(out[1].revenue).toBe(9.9)
  })
  it('also accepts a bare array', () => {
    expect(parseIncomingEvents([{ source: 'ga4', eventName: 'install', occurredAt: at }])).toHaveLength(1)
  })
})
