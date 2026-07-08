/**
 * AppGrowing competitor batch → CompetitorCreative import (pure parser +
 * normalizer). Consumed by POST /api/ingest/competitor. Payloads arrive via the
 * non-API "Approach B" path (authenticated AppGrowing export / Collections /
 * browser-plugin capture) — NOT the internal GraphQL scrape, which is ToS-risky
 * (docs/growth/06-competitor-intel-remix.md §5, Approach C).
 *
 * A batch carries two tiers:
 *   discovery[] — cheap list-level rows; most lack AppGrowing's real id, so we
 *                 synthesize a deterministic externalId from
 *                 app|headline|region|language (stable → idempotent re-ingest).
 *   enriched[]  — on-demand rows with the real drawer id + cached AI analysis.
 *
 * Every function here is pure (primitives in / out) so it needs neither a
 * NextRequest nor a Prisma client — the route stays thin and the mapping stays
 * testable. Two payload quirks handled explicitly:
 *   • `impressions` is a number on enriched rows but a coarse string
 *     (">10M-tier") on discovery rows → coerced to BigInt or null.
 *   • `duration` in the payload is a "firstSeen~lastSeen" date range, NOT the
 *     video length — it maps to firstSeenAt/lastSeenAt, never the `duration`
 *     (seconds) column.
 *
 * Ref: docs/growth/06-competitor-intel-remix.md §4–5
 */

import crypto from 'node:crypto'

export interface NormalizedCompetitor {
  externalId: string
  tier: 'discovery' | 'enriched'
  /** Relevance-filter outcome — 'drop' rows are off-target and never persisted. */
  verdict: 'keep' | 'drop'
  filterReason: string | null
  relevance: string | null
  appName: string | null
  advertiser: string | null
  mediaPlatforms: unknown[] | null
  adFormat: string | null
  region: string | null
  language: string | null
  adDays: number | null
  impressions: bigint | null
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  originalPostUrl: string | null
  ratio: string | null
  duration: number | null
  creativeTags: unknown[] | null
  sellingPoints: unknown[] | null
  emotionalTriggers: unknown[] | null
  screenUnderstanding: unknown[] | null
  storyboard: unknown | null
  transcript: string | null
  bgm: string | null
  aiPrompt: string | null
  rawMeta: Record<string, unknown>
  /** Best media URL for enriched rows (explicit media field, else originalPostUrl). */
  mediaUrl: string | null
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function arr(v: unknown): unknown[] | null {
  return Array.isArray(v) && v.length > 0 ? v : null
}

function firstHttp(s: string | null): string | null {
  return s && /^https?:\/\//i.test(s) ? s : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Coerce AppGrowing's impressions into a BigInt. Enriched rows give a number;
 * discovery rows give a coarse magnitude string (">10M", ">10M-tier", "710.4K").
 * Unparseable → null.
 */
export function coerceImpressions(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v >= BigInt(0) ? v : null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? BigInt(Math.round(v)) : null
  if (typeof v !== 'string') return null
  const m = v.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kmb])?/i)
  if (!m) return null
  const base = parseFloat(m[1])
  if (!Number.isFinite(base)) return null
  const mult = m[2] ? { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase() as 'k' | 'm' | 'b'] : 1
  return BigInt(Math.round(base * mult))
}

/**
 * Parse AppGrowing's "firstSeen~lastSeen" range (e.g. "2023-08-03~2025-10-03").
 * Split only on '~' — the dates themselves contain '-'. Invalid halves → null.
 */
export function parseDateRange(v: unknown): { firstSeenAt: Date | null; lastSeenAt: Date | null } {
  if (typeof v !== 'string') return { firstSeenAt: null, lastSeenAt: null }
  const parts = v.split('~').map((s) => s.trim())
  const toDate = (s?: string) => {
    if (!s) return null
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return { firstSeenAt: toDate(parts[0]), lastSeenAt: toDate(parts[1]) }
}

/** Aspect ratio from an explicit field, else the "(9:16)" inside a format string. */
export function parseRatio(explicit: unknown, format: string | null): string | null {
  const e = str(explicit)
  if (e && /^\d+:\d+$/.test(e)) return e
  if (format) {
    const m = format.match(/(\d+:\d+)/)
    if (m) return m[1]
  }
  return null
}

/**
 * Deterministic externalId for discovery rows that lack AppGrowing's real id.
 * Keyed on app|headline|region|language so the same row re-ingests idempotently.
 */
export function synthExternalId(parts: {
  app?: unknown
  headline?: unknown
  region?: unknown
  language?: unknown
}): string {
  const key = [parts.app, parts.headline, parts.region, parts.language]
    .map((x) => (x == null ? '' : String(x)).trim().toLowerCase())
    .join('|')
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20)
  return `syn_${hash}`
}

/**
 * Relevance triage — drop off-target keyword false-matches. A row is dropped
 * when it carries a filter reason, or its relevance is a FILTER-OUT / off-target
 * marker. Everything else (core, adjacent-*) is kept.
 */
export function relevanceVerdict(relevance: unknown, filterReason?: unknown): 'keep' | 'drop' {
  if (str(filterReason) != null) return 'drop'
  const r = (relevance == null ? '' : String(relevance)).trim().toLowerCase()
  if (r.startsWith('filter-out')) return 'drop'
  if (r.startsWith('off-target')) return 'drop'
  return 'keep'
}

/** Best media URL to fetch for an enriched row: explicit media field, else originalPostUrl. */
export function pickMediaUrl(row: Record<string, unknown>): string | null {
  for (const c of [row.mediaUrl, row.videoUrl, row.imageUrl, row.fileUrl]) {
    const s = firstHttp(str(c))
    if (s) return s
  }
  if (Array.isArray(row.mediaUrls)) {
    for (const c of row.mediaUrls) {
      const s = firstHttp(str(c))
      if (s) return s
    }
  }
  return firstHttp(str(row.originalPostUrl ?? row.originalPost))
}

function normalizeRow(row: Record<string, unknown>, tier: 'discovery' | 'enriched'): NormalizedCompetitor {
  const app = str(row.app ?? row.appName)
  const headline = str(row.headline)
  const region = str(row.region)
  const language = str(row.language)
  const explicitId = str(row.externalId ?? row.id ?? row.drawerId)
  const externalId = explicitId ?? synthExternalId({ app, headline, region, language })
  const filterReason = str(row._filterReason ?? row.filterReason)
  const format = str(row.format ?? row.adFormat)
  // The payload's `duration` is a date range, not a video length.
  const { firstSeenAt, lastSeenAt } = parseDateRange(row.duration ?? row.dateRange ?? row.datePeriod)

  return {
    externalId,
    tier,
    verdict: relevanceVerdict(row.relevance, filterReason),
    filterReason,
    relevance: str(row.relevance),
    appName: app,
    advertiser: str(row.advertiser),
    mediaPlatforms: arr(row.media) ?? arr(row.mediaPlatforms),
    adFormat: format,
    region,
    language,
    adDays: num(row.adDays),
    impressions: coerceImpressions(row.impressions),
    firstSeenAt,
    lastSeenAt,
    originalPostUrl: firstHttp(str(row.originalPostUrl ?? row.originalPost)),
    ratio: parseRatio(row.ratio ?? row.aspectRatio, format),
    // Video length in seconds — a distinct numeric field, never the `duration` range above.
    duration: num(row.videoDuration ?? row.durationSec ?? row.durationSeconds),
    creativeTags: arr(row.creativeTags),
    sellingPoints: arr(row.sellingPoints),
    emotionalTriggers: arr(row.emotionalTriggers),
    screenUnderstanding: arr(row.screenUnderstanding),
    storyboard: row.storyboard != null ? row.storyboard : null,
    transcript: str(row.transcript ?? row.speechToText),
    bgm: str(row.bgm),
    aiPrompt: str(row.aiPrompt ?? row.aiPromptStructure),
    rawMeta: row,
    mediaUrl: pickMediaUrl(row),
  }
}

/**
 * Parse an inbound competitor batch. Accepts the captured shape
 * `{ source?, discovery?[], enriched?[] }`, and also a bare array or
 * `{ competitors: [] }` (treated as discovery-tier). Non-object rows are skipped.
 */
export function parseCompetitorBatch(raw: unknown): { source: string; rows: NormalizedCompetitor[] } {
  const obj = isRecord(raw) ? raw : {}
  const source = str(obj.source) ?? 'appgrowing'
  const rows: NormalizedCompetitor[] = []

  const discovery = Array.isArray(obj.discovery) ? obj.discovery : []
  const enriched = Array.isArray(obj.enriched) ? obj.enriched : []
  const bare = Array.isArray(raw) ? raw : Array.isArray(obj.competitors) ? obj.competitors : []

  for (const r of discovery) if (isRecord(r)) rows.push(normalizeRow(r, 'discovery'))
  for (const r of enriched) if (isRecord(r)) rows.push(normalizeRow(r, 'enriched'))
  for (const r of bare) if (isRecord(r)) rows.push(normalizeRow(r, 'discovery'))

  return { source, rows }
}
