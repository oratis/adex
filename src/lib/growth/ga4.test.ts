import { describe, it, expect } from 'vitest'
import { mapGa4Event, mapGa4Events } from './ga4'
import { EVENTS, SOURCES } from './events'
import { CHANNELS } from './channels'

const at = 1_700_000_000_000

describe('mapGa4Event', () => {
  it('maps first_open → install and resolves channel from utm', () => {
    const r = mapGa4Event({ eventName: 'first_open', occurredAt: at, userPseudoId: 'p1', utmSource: 'adex_meta_web' })
    expect(r).toMatchObject({ source: SOURCES.GA4, eventName: EVENTS.INSTALL, userKey: 'p1', channel: CHANNELS.PAID_META_WEB })
    expect(r?.occurredAt.getTime()).toBe(at)
  })
  it('maps Cuddler custom events', () => {
    expect(mapGa4Event({ eventName: 'chat.started', occurredAt: at })?.eventName).toBe(EVENTS.FIRST_CHAT)
    expect(mapGa4Event({ eventName: 'scene.generated', occurredAt: at })?.eventName).toBe(EVENTS.SCENE_GENERATED)
    expect(mapGa4Event({ eventName: 'auth.signup_completed', occurredAt: at })?.eventName).toBe(EVENTS.SIGNUP)
    expect(mapGa4Event({ eventName: 'subscription.activated', occurredAt: at })?.eventName).toBe(EVENTS.SUBSCRIPTION_ACTIVATED)
  })
  it('defaults to organic when no utm', () => {
    expect(mapGa4Event({ eventName: 'first_open', occurredAt: at })?.channel).toBe(CHANNELS.ORGANIC)
  })
  it('ignores unknown event names and missing timestamps', () => {
    expect(mapGa4Event({ eventName: 'session_start', occurredAt: at })).toBeNull()
    expect(mapGa4Event({ eventName: 'first_open', occurredAt: 0 })).toBeNull()
  })
  it('mapGa4Events drops unmapped rows', () => {
    const out = mapGa4Events([
      { eventName: 'first_open', occurredAt: at },
      { eventName: 'noise', occurredAt: at },
      { eventName: 'chat.started', occurredAt: at },
    ])
    expect(out).toHaveLength(2)
  })
})
