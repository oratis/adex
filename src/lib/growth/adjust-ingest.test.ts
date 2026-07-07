import { describe, it, expect } from 'vitest'
import { mapAdjustCallback } from './adjust-ingest'
import { EVENTS, SOURCES } from './events'
import { CHANNELS } from './channels'

const createdAt = '1751500800' // 2025-07-03T00:00:00Z

describe('mapAdjustCallback', () => {
  it('maps an install activity_kind to install', () => {
    const r = mapAdjustCallback({
      activity_kind: 'install',
      network_name: 'Apple Search Ads',
      adid: 'abc123',
      created_at: createdAt,
      country: 'US',
    })
    expect(r).toMatchObject({
      source: SOURCES.ADJUST,
      eventName: EVENTS.INSTALL,
      userKey: 'adjust:abc123',
      channel: CHANNELS.PAID_ASA,
      country: 'US',
    })
    expect(r?.occurredAt.getTime()).toBe(Number(createdAt) * 1000)
  })

  it('prefers the transmitted RC app_user_id over the adid namespace fallback (decision B)', () => {
    const r = mapAdjustCallback({
      activity_kind: 'install',
      adid: 'abc123',
      app_user_id: 'rc-user-1',
      created_at: createdAt,
    })
    expect(r?.userKey).toBe('rc-user-1')
  })

  it('maps a mapped event_token via the caller-supplied map', () => {
    const r = mapAdjustCallback(
      { activity_kind: 'event', event_token: 'abc1', created_at: createdAt, adid: 'x1' },
      { abc1: EVENTS.FIRST_CHAT },
    )
    expect(r?.eventName).toBe(EVENTS.FIRST_CHAT)
  })

  it('drops an event activity_kind with an unmapped token', () => {
    const r = mapAdjustCallback(
      { activity_kind: 'event', event_token: 'unknown', created_at: createdAt, adid: 'x1' },
      { abc1: EVENTS.FIRST_CHAT },
    )
    expect(r).toBeNull()
  })

  it('drops event without an event_token map at all', () => {
    expect(mapAdjustCallback({ activity_kind: 'event', event_token: 'abc1', created_at: createdAt })).toBeNull()
  })

  it('drops reattribution and session activity_kinds', () => {
    expect(mapAdjustCallback({ activity_kind: 'reattribution', created_at: createdAt })).toBeNull()
    expect(mapAdjustCallback({ activity_kind: 'session', created_at: createdAt })).toBeNull()
  })

  it('drops when created_at is missing or unparseable', () => {
    expect(mapAdjustCallback({ activity_kind: 'install', adid: 'x1' })).toBeNull()
    expect(mapAdjustCallback({ activity_kind: 'install', adid: 'x1', created_at: 'not-a-number' })).toBeNull()
  })

  it('falls back to null userKey when neither app_user_id nor adid is present', () => {
    const r = mapAdjustCallback({ activity_kind: 'install', created_at: createdAt })
    expect(r?.userKey).toBeNull()
  })

  it('resolves channel via resolveAdjustChannel, defaulting unmapped networks to organic', () => {
    const r = mapAdjustCallback({ activity_kind: 'install', created_at: createdAt, network_name: 'Some Ad Network' })
    expect(r?.channel).toBe(CHANNELS.ORGANIC)
  })

  it('preserves raw params', () => {
    const params = { activity_kind: 'install', created_at: createdAt, adid: 'x1' }
    const r = mapAdjustCallback(params)
    expect(r?.raw).toBe(params)
  })
})

describe('mapAdjustCallback — os (bi §6)', () => {
  it('normalizes os_name=ios/android to our Os enum', () => {
    expect(mapAdjustCallback({ activity_kind: 'install', created_at: createdAt, adid: 'x1', os_name: 'ios' })?.os).toBe('ios')
    expect(mapAdjustCallback({ activity_kind: 'install', created_at: createdAt, adid: 'x1', os_name: 'iOS' })?.os).toBe('ios')
    expect(mapAdjustCallback({ activity_kind: 'install', created_at: createdAt, adid: 'x1', os_name: 'android' })?.os).toBe('android')
  })
  it('falls back to device_type=web when os_name is absent', () => {
    expect(mapAdjustCallback({ activity_kind: 'install', created_at: createdAt, adid: 'x1', device_type: 'web' })?.os).toBe('web')
  })
  it('is null when neither os_name nor a recognizable device_type is present', () => {
    expect(mapAdjustCallback({ activity_kind: 'install', created_at: createdAt, adid: 'x1' })?.os).toBeNull()
  })
})
