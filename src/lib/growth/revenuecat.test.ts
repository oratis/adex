import { describe, it, expect } from 'vitest'
import { mapRevenueCatEvent } from './revenuecat'
import { EVENTS, SOURCES } from './events'

const at = 1_700_000_000_000

function body(event: Record<string, unknown>) {
  return { api_version: '1.0', event: { app_user_id: 'u1', event_timestamp_ms: at, ...event } }
}

describe('mapRevenueCatEvent', () => {
  it('maps a paid INITIAL_PURCHASE to subscription_activated with revenue', () => {
    const r = mapRevenueCatEvent(body({ type: 'INITIAL_PURCHASE', period_type: 'NORMAL', price: 9.9 }))
    expect(r).toMatchObject({
      source: SOURCES.REVENUECAT,
      eventName: EVENTS.SUBSCRIPTION_ACTIVATED,
      userKey: 'u1',
      revenue: 9.9,
      channel: null,
    })
    expect(r?.occurredAt.getTime()).toBe(at)
  })
  it('maps a TRIAL INITIAL_PURCHASE to trial_start with zero revenue', () => {
    const r = mapRevenueCatEvent(body({ type: 'INITIAL_PURCHASE', period_type: 'TRIAL', price: 0 }))
    expect(r?.eventName).toBe(EVENTS.TRIAL_START)
    expect(r?.revenue).toBe(0)
  })
  it('maps RENEWAL to renewal with revenue', () => {
    expect(mapRevenueCatEvent(body({ type: 'RENEWAL', price: 9.9 }))?.eventName).toBe(EVENTS.RENEWAL)
  })
  it('maps NON_RENEWING_PURCHASE to subscription_activated', () => {
    expect(mapRevenueCatEvent(body({ type: 'NON_RENEWING_PURCHASE', price: 2.99 }))?.revenue).toBe(2.99)
  })
  it('maps CANCELLATION and EXPIRATION to churn', () => {
    expect(mapRevenueCatEvent(body({ type: 'CANCELLATION' }))?.eventName).toBe(EVENTS.CHURN)
    expect(mapRevenueCatEvent(body({ type: 'EXPIRATION' }))?.eventName).toBe(EVENTS.CHURN)
  })
  it('ignores non-funnel event types', () => {
    expect(mapRevenueCatEvent(body({ type: 'TEST' }))).toBeNull()
    expect(mapRevenueCatEvent(body({ type: 'BILLING_ISSUE' }))).toBeNull()
    expect(mapRevenueCatEvent(body({ type: 'PRODUCT_CHANGE' }))).toBeNull()
  })
  it('falls back to purchased_at_ms when event_timestamp_ms absent', () => {
    const r = mapRevenueCatEvent({ event: { type: 'RENEWAL', app_user_id: 'u1', purchased_at_ms: at, price: 5 } })
    expect(r?.occurredAt.getTime()).toBe(at)
  })
  it('returns null on malformed / missing payloads', () => {
    expect(mapRevenueCatEvent(null)).toBeNull()
    expect(mapRevenueCatEvent({})).toBeNull()
    expect(mapRevenueCatEvent({ event: { type: 'RENEWAL' } })).toBeNull() // no timestamp
    expect(mapRevenueCatEvent({ event: {} })).toBeNull()
  })
})
