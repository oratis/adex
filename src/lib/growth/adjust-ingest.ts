/**
 * Adjust S2S callback → ConversionEvent mapping (pure).
 *
 * Adjust's real-time callback is a URL template Adjust expands per-event and
 * GETs/POSTs to us — see docs/growth/06-mmp-ingest.md §3. Only `install` and
 * mapped `event` activity kinds are funnel-relevant; everything else
 * (`reattribution`, `session`, unmapped event tokens) is dropped, not thrown,
 * so a misconfigured callback never 500s the route.
 *
 * userKey (decision B, 06-mmp-ingest.md §2): prefer the RC `app_user_id`
 * transmitted as an Adjust callback parameter — NOT a partner parameter, those go
 * to ad networks; callback params come back on raw-data callbacks (AF analogue:
 * customer_user_id/CUID). Set via SDK after registration. If absent, we
 * fall back to `adjust:${adid}` — a namespaced id that intentionally does NOT
 * join with GA4 pseudo ids or RC app_user_ids. Cohort-level consequences of
 * that downgrade are documented in cohorts.ts / kpi-canon.ts.
 *
 * Ref: docs/growth/06-mmp-ingest.md §1 hole 3, §2 decision B, §3
 */

import { EVENTS, SOURCES, type ConversionEventInput, type EventName, type Os } from './events'
import { resolveAdjustChannel } from './channels'
import { parseCampaignName } from './campaign-name'

/** Adjust `event_token` → our canonical EventName. Unmapped tokens are dropped. */
export type AdjustEventTokenMap = Record<string, EventName>

export interface AdjustCallbackParams {
  activity_kind?: string
  event_token?: string
  network_name?: string
  campaign_name?: string
  adid?: string
  /** unix seconds, as Adjust sends it. */
  created_at?: string
  country?: string
  /** RC app_user_id transmitted as a callback parameter (decision B). */
  app_user_id?: string
  /** Adjust standard placeholder — "ios" | "android" (native SDK installs). */
  os_name?: string
  /** Adjust standard placeholder — used here only to catch web-SDK installs
   * that report a device_type of "web" instead of an os_name. */
  device_type?: string
  [key: string]: string | undefined
}

/** Normalize Adjust's `os_name`/`device_type` placeholders to our Os enum. */
function normalizeAdjustOs(params: AdjustCallbackParams): Os | null {
  const osName = params.os_name?.trim().toLowerCase()
  if (osName === 'ios') return 'ios'
  if (osName === 'android') return 'android'
  if (osName === 'web') return 'web'
  const deviceType = params.device_type?.trim().toLowerCase()
  if (deviceType === 'web') return 'web'
  return null
}

/**
 * Map one Adjust S2S callback request to a normalized ConversionEventInput, or
 * null if it isn't funnel-relevant (unmapped activity_kind / event_token,
 * missing timestamp).
 */
export function mapAdjustCallback(
  params: AdjustCallbackParams,
  eventTokenMap: AdjustEventTokenMap = {},
): ConversionEventInput | null {
  const activityKind = params.activity_kind?.trim().toLowerCase()

  let eventName: EventName | undefined
  if (activityKind === 'install') {
    eventName = EVENTS.INSTALL
  } else if (activityKind === 'event') {
    const token = params.event_token
    eventName = token ? eventTokenMap[token] : undefined
  }
  // 'reattribution', 'session', and anything else are not in our funnel
  // vocabulary — drop, don't guess.
  if (!eventName) return null

  const createdAtSec = Number(params.created_at)
  if (!Number.isFinite(createdAtSec) || createdAtSec <= 0) return null

  const userKey = params.app_user_id?.trim() || (params.adid ? `adjust:${params.adid}` : null)

  // channel stays authoritative from network_name (resolveAdjustChannel) —
  // the campaign-name parse below is only consulted for os fallback and the
  // agency/bidStrategy/conversionGoal dimensions it uniquely owns (bi §7).
  const { channel } = resolveAdjustChannel(params.network_name, params.campaign_name)
  const parsedName = parseCampaignName(params.campaign_name)

  // os is authoritative from Adjust's own os_name/device_type fields;
  // campaign-name-derived os is only a fallback when both are absent.
  const os = normalizeAdjustOs(params) ?? parsedName?.os ?? null

  return {
    source: SOURCES.ADJUST,
    eventName,
    occurredAt: new Date(createdAtSec * 1000),
    userKey,
    utmCampaign: params.campaign_name ?? null,
    channel,
    os,
    country: params.country ?? null,
    revenue: 0,
    agency: parsedName?.agency ?? null,
    bidStrategy: parsedName?.bidStrategy ?? null,
    conversionGoal: parsedName?.goal ?? null,
    raw: params,
  }
}
