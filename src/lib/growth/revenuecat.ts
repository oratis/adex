/**
 * RevenueCat webhook → ConversionEvent mapper (pure).
 *
 * RC is the pilot's real-payment signal — the only input the payment_signal_gate
 * (pilot-gates.ts) trusts to authorize scaling. This maps RC's event types to
 * our canonical event names; the route attaches orgId/appId and persists.
 *
 * RC has no TRIAL_STARTED type — trials arrive as INITIAL_PURCHASE with
 * period_type=TRIAL. Trial→paid later appears as a RENEWAL. RC carries no UTM,
 * so channel is left null here and attributed later by joining on userKey.
 *
 * Docs: https://www.revenuecat.com/docs/webhooks
 * Ref: docs/growth/00-cuddler-first-redesign.md §5.1
 */

import { EVENTS, SOURCES, type ConversionEventInput, type EventName, type Os } from './events'

function asNumber(x: unknown): number {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string') {
    const n = Number(x)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function asString(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 ? x : null
}

/**
 * RC's `event.store` (app_store | mac_app_store | play_store | amazon |
 * stripe | rc_billing | promotional) tells us which storefront the purchase
 * went through — a reasonable OS proxy since RC has no device OS field of
 * its own. Conservative mapping (bi §6): only the three stores we can place
 * confidently; everything else (amazon, promotional, unknown) is left null
 * rather than guessed.
 */
function osFromStore(store: string | null): Os | null {
  switch (store) {
    case 'app_store':
      return 'ios'
    case 'play_store':
      return 'android'
    case 'stripe':
    case 'rc_billing':
      return 'web'
    default:
      return null
  }
}

/**
 * Map one RevenueCat webhook body to a normalized event, or null if the event
 * type is not funnel-relevant (TEST, BILLING_ISSUE, PRODUCT_CHANGE, ...).
 */
export function mapRevenueCatEvent(payload: unknown): ConversionEventInput | null {
  if (!payload || typeof payload !== 'object') return null
  const event = (payload as Record<string, unknown>).event
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>

  const type = asString(e.type)?.toUpperCase()
  if (!type) return null

  const periodType = asString(e.period_type)?.toUpperCase()
  const price = asNumber(e.price)

  let eventName: EventName
  let revenue = 0
  switch (type) {
    case 'INITIAL_PURCHASE':
      if (periodType === 'TRIAL' || periodType === 'INTRO') {
        eventName = EVENTS.TRIAL_START
      } else {
        eventName = EVENTS.SUBSCRIPTION_ACTIVATED
        revenue = price
      }
      break
    case 'NON_RENEWING_PURCHASE':
      eventName = EVENTS.SUBSCRIPTION_ACTIVATED
      revenue = price
      break
    case 'RENEWAL':
      eventName = EVENTS.RENEWAL
      revenue = price
      break
    case 'CANCELLATION':
    case 'EXPIRATION':
      eventName = EVENTS.CHURN
      break
    default:
      return null // TEST, BILLING_ISSUE, PRODUCT_CHANGE, TRANSFER, ...
  }

  const tsMs = asNumber(e.event_timestamp_ms) || asNumber(e.purchased_at_ms)
  if (!tsMs) return null
  const userKey = asString(e.app_user_id) ?? asString(e.original_app_user_id)
  const store = asString(e.store)?.toLowerCase() ?? null

  return {
    source: SOURCES.REVENUECAT,
    eventName,
    occurredAt: new Date(tsMs),
    userKey,
    channel: null, // RC carries no UTM; attributed later via userKey join
    os: osFromStore(store),
    country: asString(e.country_code),
    revenue, // gross RC-reported price; net-of-store-fee applied downstream
    raw: payload,
  }
}
