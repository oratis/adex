/**
 * Channel taxonomy — the single place that defines what a "channel" is and how
 * an inbound conversion is attributed to one. ConversionEvent.channel,
 * CohortSnapshot.channel, the pilot allocation arms, and the skan_maturity
 * guardrail all resolve through here so the taxonomy never forks.
 *
 * Attribution follows the UTM convention in the integration contract
 * (docs/growth/02-integration-contract.md §3.2):
 *   utm_source = adex_{arm}   e.g. adex_meta_web, adex_tiktok_web, adex_asa
 *
 * Ref: docs/growth/01-5k-pilot-plan.md §P2 (arms), §P6 (SKAN maturity)
 */

/** Canonical channel ids. Paid arms mirror the pilot allocation table. */
export const CHANNELS = {
  // Paid — web funnel (GA4/Stripe deterministic attribution, the pilot spine)
  PAID_META_WEB: 'paid_meta_web',
  PAID_TIKTOK_WEB: 'paid_tiktok_web',
  // Paid — iOS App Store intent (ASA self-attributing, not SKAN)
  PAID_ASA: 'paid_asa',
  // Paid — iOS app-install on SKAN placements (reach test only, low trust)
  PAID_META_IOS: 'paid_meta_ios',
  PAID_TIKTOK_IOS: 'paid_tiktok_ios',
  // Paid — app campaigns (post-pilot)
  PAID_GOOGLE_UAC: 'paid_google_uac',
  // Earned
  KOL: 'kol',
  REFERRAL: 'referral',
  ORGANIC: 'organic',
  SEO: 'seo',
  ASO: 'aso',
} as const

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS]

const ALL: Channel[] = Object.values(CHANNELS)
const PAID: Set<Channel> = new Set([
  CHANNELS.PAID_META_WEB,
  CHANNELS.PAID_TIKTOK_WEB,
  CHANNELS.PAID_ASA,
  CHANNELS.PAID_META_IOS,
  CHANNELS.PAID_TIKTOK_IOS,
  CHANNELS.PAID_GOOGLE_UAC,
])
// SKAN-attributed iOS placements: attribution is delayed 24–72h and postbacks
// may be null at low volume. ASA is excluded (self-attributing via AdServices).
const SKAN: Set<Channel> = new Set([CHANNELS.PAID_META_IOS, CHANNELS.PAID_TIKTOK_IOS])

export function isChannel(v: string): v is Channel {
  return (ALL as string[]).includes(v)
}

/** True for channels that cost media money (CAC applies). */
export function isPaidChannel(c: Channel): boolean {
  return PAID.has(c)
}

/**
 * True for SKAN-attributed iOS channels. The skan_maturity guardrail suppresses
 * auto-action on these until data is ≥72h old (see pilot-gates evaluateChannel).
 */
export function isSkanChannel(c: Channel): boolean {
  return SKAN.has(c)
}

export type Confidence = 'deterministic' | 'skan' | 'inferred'

/**
 * Resolve an inbound event to a canonical channel.
 *
 * Priority:
 *  1. Explicit `adex_{arm}` utm_source (our own tagged traffic) → deterministic
 *     (or `skan` confidence for iOS SKAN arms).
 *  2. Known earned utm sources (referral/kol codes) → inferred.
 *  3. No/unknown utm → organic.
 *
 * @returns the channel plus an attribution confidence flag — callers must not
 *   treat a `skan` or `inferred` attribution as deterministic.
 */
export function resolveChannel(input: {
  utmSource?: string | null
  utmMedium?: string | null
}): { channel: Channel; confidence: Confidence } {
  const src = (input.utmSource ?? '').trim().toLowerCase()

  if (src.startsWith('adex_')) {
    const arm = src.slice('adex_'.length)
    const candidate = `paid_${arm}`
    if (isChannel(candidate)) {
      const channel = candidate as Channel
      return { channel, confidence: isSkanChannel(channel) ? 'skan' : 'deterministic' }
    }
    // adex_-tagged but unrecognized arm — attribute as organic, low confidence
    return { channel: CHANNELS.ORGANIC, confidence: 'inferred' }
  }

  // Earned traffic tagged with a bare source.
  if (src === 'kol' || src === 'referral' || src === 'seo' || src === 'aso') {
    return { channel: src as Channel, confidence: 'inferred' }
  }

  return { channel: CHANNELS.ORGANIC, confidence: src ? 'inferred' : 'deterministic' }
}

// ── Adjust (MMP) network → channel mapping ──────────────────────────────
// Adjust callbacks report `network_name` (and `campaign_name`), not our
// adex_{arm} UTM convention — resolveChannel() doesn't recognize these names
// and would bucket them all into organic (the "channel norm失配" hole,
// docs/growth/06-mmp-ingest.md §1 hole 2). This is a separate, explicit table
// so resolveChannel's own UTM-first contract stays untouched.
//
// Adjust's `network_name` doesn't distinguish web vs iOS-app-install for
// Meta/TikTok — both surface as e.g. "Facebook Installs" / "Instagram
// Installs". We conservatively map these to the *_ios (SKAN) channel, the
// lower-trust/lower-confidence bucket, since Adjust is an app-install MMP and
// most orgs wiring it up are attributing native app installs, not the web
// funnel. If `campaignName` carries a recognizable hint (e.g. contains "web"),
// we prefer that signal over the network-name default. This is a documented
// approximation — revisit if a customer's actual Adjust setup differs.
export const ADJUST_NETWORK_MAP: Record<string, Channel> = {
  'apple search ads': CHANNELS.PAID_ASA,
  'facebook installs': CHANNELS.PAID_META_IOS,
  'facebook ads': CHANNELS.PAID_META_IOS,
  'instagram installs': CHANNELS.PAID_META_IOS,
  'meta installs': CHANNELS.PAID_META_IOS,
  'tiktok installs': CHANNELS.PAID_TIKTOK_IOS,
  'tiktok for business': CHANNELS.PAID_TIKTOK_IOS,
  'google ads': CHANNELS.PAID_GOOGLE_UAC,
  'google installs': CHANNELS.PAID_GOOGLE_UAC,
  organic: CHANNELS.ORGANIC,
}

/**
 * Resolve an Adjust `network_name` (+ optional `campaign_name`) to a canonical
 * channel. Case-insensitive on network name. Unmapped networks fall back to
 * organic with `inferred` confidence (never throws, never silently mis-buckets
 * as a paid channel).
 */
export function resolveAdjustChannel(
  networkName?: string | null,
  campaignName?: string | null,
): { channel: Channel; confidence: Confidence } {
  const network = (networkName ?? '').trim().toLowerCase()
  const campaign = (campaignName ?? '').trim().toLowerCase()

  const mapped = ADJUST_NETWORK_MAP[network]
  if (!mapped) {
    return { channel: CHANNELS.ORGANIC, confidence: 'inferred' }
  }

  // Meta/TikTok network names are app-install-only in our table (mapped to the
  // *_ios SKAN channel); if the campaign name explicitly signals a web-funnel
  // campaign, prefer that over the app-install default.
  if (mapped === CHANNELS.PAID_META_IOS && campaign.includes('web')) {
    return { channel: CHANNELS.PAID_META_WEB, confidence: 'inferred' }
  }
  if (mapped === CHANNELS.PAID_TIKTOK_IOS && campaign.includes('web')) {
    return { channel: CHANNELS.PAID_TIKTOK_WEB, confidence: 'inferred' }
  }

  if (mapped === CHANNELS.PAID_ASA) return { channel: mapped, confidence: 'deterministic' }
  if (isSkanChannel(mapped)) return { channel: mapped, confidence: 'skan' }
  if (mapped === CHANNELS.ORGANIC) return { channel: mapped, confidence: 'deterministic' }
  return { channel: mapped, confidence: 'inferred' }
}

// ── CohortSnapshot.channel → Report.platform bridge (bi §7) ────────────────
// Report rows carry a bare ad-platform string (google/meta/tiktok/...), not a
// Channel — this is the inverse direction of PLATFORM_TO_CHANNEL
// (src/app/api/cron/growth-sync/route.ts), used by /api/reports/breakdown to
// join spend rows back to CohortSnapshot funnel rows on (date, os, platform,
// agency). Earned channels (organic/kol/referral/seo/aso) have no
// corresponding ad platform and correctly map to null — they never join.
const CHANNEL_TO_PLATFORM: Partial<Record<Channel, string>> = {
  [CHANNELS.PAID_GOOGLE_UAC]: 'google',
  [CHANNELS.PAID_META_WEB]: 'meta',
  [CHANNELS.PAID_META_IOS]: 'meta',
  [CHANNELS.PAID_TIKTOK_WEB]: 'tiktok',
  [CHANNELS.PAID_TIKTOK_IOS]: 'tiktok',
  [CHANNELS.PAID_ASA]: 'apple_search_ads',
}

/**
 * Resolve a CohortSnapshot channel to the Report.platform string it can join
 * against. Earned/organic channels and any channel this map doesn't cover
 * return `null` — they don't participate in the funnel↔spend join, they're
 * not "joined to zero".
 */
export function channelToPlatform(channel: string): string | null {
  if (!isChannel(channel)) return null
  return CHANNEL_TO_PLATFORM[channel] ?? null
}
