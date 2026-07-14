/**
 * Campaign-name canon (docs/growth/06-mmp-ingest.md §7) — the positional
 * naming convention marketers use for every campaign, and the pure parser
 * that turns a raw campaign name into structured dimensions.
 *
 * Convention (`-`-delimited, position = semantics):
 *   agency-date-bidStrategy-os-region(s)-channelHint-index-product-goal-audience-custom...
 * Example:
 *   inhouse-20260512-mai-Android-US/T1/JP-Google-01-Luddi-install-female-Davis-xx
 *
 * Design notes:
 * - Word lists (agency / bidStrategy / conversionGoal) are customer-defined,
 *   not a fixed enum — we don't whitelist-validate them, just lowercase them
 *   for consistent grouping/joins. Position-carrying but free-text fields
 *   (channelHint, product, audience, custom) are kept verbatim.
 * - Segment count can be short (fields past the last segment are `null`) or
 *   long (anything past position 10 collects into `custom`).
 * - `os` is enum-normalized (ios | android | web); unrecognized text is kept
 *   in `osRaw` rather than guessed. Same pattern for `date`/`dateRaw`.
 * - Never throws. Malformed input (empty string, no `-` at all, non-string)
 *   returns `null` — the caller (adjust-ingest.ts, report-writer.ts) treats
 *   that as "can't attribute from this name", not an error.
 *
 * Ref: docs/growth/06-mmp-ingest.md §7
 */

export type CampaignOs = 'ios' | 'android' | 'web'

export interface ParsedCampaignName {
  /** Media-buying agency, lowercased. Null if the segment is missing/empty. */
  agency: string | null
  /** Campaign start/launch date, validated `YYYYMMDD`. Null if missing or malformed. */
  date: string | null
  /** The raw date segment as written, regardless of whether it validated. */
  dateRaw: string | null
  /** Bid strategy label, lowercased. Null if missing. */
  bidStrategy: string | null
  /** Enum-normalized OS, or null if the segment is missing/unrecognized. */
  os: CampaignOs | null
  /** The raw os segment as written. */
  osRaw: string | null
  /** Region codes, split on `/` within the region segment (e.g. "US/T1/JP" → ["US","T1","JP"]). */
  regions: string[]
  /** Free-text channel hint (e.g. "Google") — verbatim, not resolved to a canonical Channel. */
  channelHint: string | null
  /** Campaign index/serial (e.g. "01"), verbatim. */
  index: string | null
  /** Product name, verbatim. */
  product: string | null
  /** Conversion goal, lowercased. */
  goal: string | null
  /** Audience/targeting hint, verbatim. */
  audience: string | null
  /** Any segments beyond position 10, verbatim, in order. */
  custom: string[]
}

const DATE_RE = /^\d{8}$/

function normalizeOs(raw: string | null): CampaignOs | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (v === 'ios' || v === 'android' || v === 'web') return v
  return null
}

/** `undefined`/empty-string segment → null; otherwise the segment as-is. */
function seg(segments: string[], i: number): string | null {
  const v = segments[i]
  return v !== undefined && v !== '' ? v : null
}

/**
 * Parse a campaign name into its positional dimensions, or `null` if the
 * input isn't a non-empty string containing at least one `-` separator.
 * Pure, never throws.
 */
export function parseCampaignName(name: unknown): ParsedCampaignName | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  if (!trimmed) return null

  const segments = trimmed.split('-')
  if (segments.length < 2) return null

  const agencyRaw = seg(segments, 0)
  const dateRaw = seg(segments, 1)
  const bidStrategyRaw = seg(segments, 2)
  const osRaw = seg(segments, 3)
  const regionRaw = seg(segments, 4)
  const channelHint = seg(segments, 5)
  const index = seg(segments, 6)
  const product = seg(segments, 7)
  const goalRaw = seg(segments, 8)
  const audience = seg(segments, 9)
  const custom = segments.slice(10)

  return {
    agency: agencyRaw ? agencyRaw.toLowerCase() : null,
    date: dateRaw && DATE_RE.test(dateRaw) ? dateRaw : null,
    dateRaw,
    bidStrategy: bidStrategyRaw ? bidStrategyRaw.toLowerCase() : null,
    os: normalizeOs(osRaw),
    osRaw,
    regions: regionRaw ? regionRaw.split('/').filter(Boolean) : [],
    channelHint,
    index,
    product,
    goal: goalRaw ? goalRaw.toLowerCase() : null,
    audience,
    custom,
  }
}
