/**
 * GA4 → ConversionEvent mapping (pure) + a thin GA4 Data API client.
 *
 * GA4 is the funnel-event source (install/signup/first_chat/scene). Cuddler's
 * event names come from its analytics_canon.md; we map them to our canonical
 * EventName and resolve channel from UTM. The mapper is pure/testable; the
 * client's runReport needs a Google access token (ADC / service account), the
 * same auth pattern as src/lib/storage.ts.
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §5.1
 */

import { EVENTS, SOURCES, type ConversionEventInput, type EventName } from './events'
import { resolveChannel } from './channels'

/** GA4 event name → our canonical EventName. Unknown names are ignored. */
const GA4_EVENT_MAP: Record<string, EventName> = {
  first_open: EVENTS.INSTALL,
  'auth.signup_completed': EVENTS.SIGNUP,
  sign_up: EVENTS.SIGNUP,
  'chat.started': EVENTS.FIRST_CHAT,
  'scene.generated': EVENTS.SCENE_GENERATED,
  'subscription.activated': EVENTS.SUBSCRIPTION_ACTIVATED,
}

export interface Ga4Event {
  eventName: string
  /** epoch millis (GA4 reports micros — convert before calling). */
  occurredAt: number
  userPseudoId?: string | null
  utmSource?: string | null
  utmCampaign?: string | null
  country?: string | null
  revenue?: number
}

/**
 * Map a GA4 event to a normalized ConversionEventInput, or null if the event
 * name isn't in our funnel vocabulary.
 */
export function mapGa4Event(e: Ga4Event): ConversionEventInput | null {
  const eventName = GA4_EVENT_MAP[e.eventName]
  if (!eventName) return null
  if (!e.occurredAt) return null

  const { channel } = resolveChannel({ utmSource: e.utmSource })
  return {
    source: SOURCES.GA4,
    eventName,
    occurredAt: new Date(e.occurredAt),
    userKey: e.userPseudoId ?? null,
    utmSource: e.utmSource ?? null,
    utmCampaign: e.utmCampaign ?? null,
    channel,
    country: e.country ?? null,
    revenue: e.revenue ?? 0,
    raw: e,
  }
}

export function mapGa4Events(events: Ga4Event[]): ConversionEventInput[] {
  const out: ConversionEventInput[] = []
  for (const e of events) {
    const m = mapGa4Event(e)
    if (m) out.push(m)
  }
  return out
}

// ── Thin GA4 Data API client ─────────────────────────────────────────────
// runReport hits the GA4 Data API v1beta. Auth: a Google OAuth access token
// with analytics.readonly scope (ADC on Cloud Run, or a service-account JWT).
// Kept dependency-free (fetch) to match storage.ts; token minting is the
// caller's concern.

export interface Ga4ReportRow {
  dimensionValues: { value: string }[]
  metricValues: { value: string }[]
}

/**
 * Run a GA4 report. Returns raw rows; callers translate to Ga4Event[] using the
 * dimension order they requested. Throws on non-2xx.
 */
export async function runGa4Report(params: {
  propertyId: string
  accessToken: string
  body: Record<string, unknown>
}): Promise<Ga4ReportRow[]> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${params.propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params.body),
    },
  )
  if (!res.ok) {
    throw new Error(`GA4 runReport ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const json = (await res.json()) as { rows?: Ga4ReportRow[] }
  return json.rows ?? []
}
