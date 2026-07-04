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
