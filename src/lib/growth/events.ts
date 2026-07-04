/**
 * Conversion-event taxonomy — the canonical event names and the shape ingest
 * connectors normalize into before writing a ConversionEvent row. Aligned with
 * Cuddler's analytics_canon.md so we never invent divergent names.
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §4.1
 */

import type { Channel } from './channels'

/** Canonical funnel event names (ConversionEvent.eventName). */
export const EVENTS = {
  INSTALL: 'install',
  SIGNUP: 'signup',
  FIRST_CHAT: 'first_chat',
  SCENE_GENERATED: 'scene_generated',
  TRIAL_START: 'trial_start',
  SUBSCRIPTION_ACTIVATED: 'subscription_activated',
  RENEWAL: 'renewal',
  CHURN: 'churn',
} as const

export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

/** Where a normalized event came from (ConversionEvent.source). */
export const SOURCES = {
  GA4: 'ga4',
  REVENUECAT: 'revenuecat',
  DEEPLINK: 'deeplink',
  ADJUST: 'adjust',
} as const

export type EventSource = (typeof SOURCES)[keyof typeof SOURCES]

const REVENUE_EVENTS: Set<EventName> = new Set([
  EVENTS.SUBSCRIPTION_ACTIVATED,
  EVENTS.RENEWAL,
])

/** True for events that carry money (used when summing cohort revenue). */
export function isRevenueEvent(e: EventName): boolean {
  return REVENUE_EVENTS.has(e)
}

/**
 * Normalized conversion event — the shape every connector produces and the
 * ingest layer writes. `orgId`/`appId` are attached by the route, not the
 * connector mapper (which only knows the upstream payload).
 */
export interface ConversionEventInput {
  source: EventSource
  eventName: EventName
  occurredAt: Date
  userKey?: string | null
  utmSource?: string | null
  utmCampaign?: string | null
  channel?: Channel | null
  country?: string | null
  revenue?: number
  raw?: unknown
}
