/**
 * AppGrowing competitor-intel connector (pure parsing/mapping — no DB, no
 * network I/O here; those live in the route handler). Isolates "which
 * source pushed this row" from the ingest route, per
 * docs/growth/07-competitor-intel-remix.md §5 ("把'到底走哪条取数路径'这件事
 * 隔离在一个文件里,上层不感知").
 *
 * Ref: docs/growth/07-competitor-intel-remix.md §4,
 *      docs/growth/09-pipeline-adex-integration.md §3
 */

import type { Prisma } from '@/generated/prisma/client'

export const APPGROWING_SOURCE = 'appgrowing'

/** Inbound shape for one competitor creative (POST /api/ingest/competitor). */
export interface CompetitorIngestItem {
  externalId: string
  appName?: string | null
  advertiser?: string | null
  mediaPlatforms?: unknown
  adFormat?: string | null
  region?: string | null
  language?: string | null
  level?: string | null
  adDays?: number | string | null
  impressions?: number | string | null
  firstSeenAt?: string | null
  lastSeenAt?: string | null
  originalPostUrl?: string | null
  ratio?: string | null
  duration?: number | null
  creativeTags?: unknown
  sellingPoints?: unknown
  emotionalTriggers?: unknown
  screenUnderstanding?: unknown
  storyboard?: unknown
  transcript?: string | null
  bgm?: string | null
  aiPrompt?: string | null
  segmentPlan?: unknown
  rawMeta?: unknown
  mediaUrl?: string | null
  keyframeUrl?: string | null
}

/**
 * Parse an inbound ingest payload — accepts a single object or an array
 * (bare array or `{ items: [...] }`). Drops entries missing `externalId`.
 */
export function parseCompetitorItems(raw: unknown): CompetitorIngestItem[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: unknown })?.items)
      ? (raw as { items: unknown[] }).items
      : raw && typeof raw === 'object'
        ? [raw]
        : []

  const out: CompetitorIngestItem[] = []
  for (const entry of arr as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== 'object') continue
    const externalId = typeof entry.externalId === 'string' ? entry.externalId : null
    if (!externalId) continue
    out.push({
      externalId,
      appName: typeof entry.appName === 'string' ? entry.appName : null,
      advertiser: typeof entry.advertiser === 'string' ? entry.advertiser : null,
      mediaPlatforms: entry.mediaPlatforms ?? null,
      adFormat: typeof entry.adFormat === 'string' ? entry.adFormat : null,
      region: typeof entry.region === 'string' ? entry.region : null,
      language: typeof entry.language === 'string' ? entry.language : null,
      level: typeof entry.level === 'string' ? entry.level : null,
      adDays:
        typeof entry.adDays === 'number' || typeof entry.adDays === 'string'
          ? entry.adDays
          : null,
      impressions:
        typeof entry.impressions === 'number' || typeof entry.impressions === 'string'
          ? entry.impressions
          : null,
      firstSeenAt: typeof entry.firstSeenAt === 'string' ? entry.firstSeenAt : null,
      lastSeenAt: typeof entry.lastSeenAt === 'string' ? entry.lastSeenAt : null,
      originalPostUrl: typeof entry.originalPostUrl === 'string' ? entry.originalPostUrl : null,
      ratio: typeof entry.ratio === 'string' ? entry.ratio : null,
      duration: typeof entry.duration === 'number' ? entry.duration : null,
      creativeTags: entry.creativeTags ?? null,
      sellingPoints: entry.sellingPoints ?? null,
      emotionalTriggers: entry.emotionalTriggers ?? null,
      screenUnderstanding: entry.screenUnderstanding ?? null,
      storyboard: entry.storyboard ?? null,
      transcript: typeof entry.transcript === 'string' ? entry.transcript : null,
      bgm: typeof entry.bgm === 'string' ? entry.bgm : null,
      aiPrompt: typeof entry.aiPrompt === 'string' ? entry.aiPrompt : null,
      segmentPlan: entry.segmentPlan ?? null,
      rawMeta: entry.rawMeta ?? null,
      mediaUrl: typeof entry.mediaUrl === 'string' ? entry.mediaUrl : null,
      keyframeUrl: typeof entry.keyframeUrl === 'string' ? entry.keyframeUrl : null,
    })
  }
  return out
}

/** Parse a date string, returning null on anything invalid/absent. */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const SUFFIX_MULT: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 }

/**
 * Parse a human-formatted count into a number: accepts plain numbers,
 * comma-grouped ("1,942"), and K/M/B-suffixed ("710.4K", "2.3M") — the exact
 * forms AppGrowing's UI displays (docs §1.3). Returns null on anything
 * unparseable. `Number("710.4K")` is NaN, so the old `Number()` path silently
 * nulled these — the primary ranking signals — which this fixes.
 */
function parseHumanNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const s = value.trim().replace(/,/g, '')
  const m = /^(-?\d+(?:\.\d+)?)\s*([kmb])?$/i.exec(s)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const mult = m[2] ? SUFFIX_MULT[m[2].toLowerCase()] : 1
  return n * mult
}

/** Parse impressions into a BigInt, returning null on anything invalid/absent. */
function parseImpressions(value: number | string | null | undefined): bigint | null {
  const n = parseHumanNumber(value)
  if (n === null) return null
  try {
    return BigInt(Math.trunc(n))
  } catch {
    return null
  }
}

/** Parse adDays into an integer, returning null on anything invalid/absent. */
function parseAdDays(value: number | string | null | undefined): number | null {
  const n = parseHumanNumber(value)
  return n === null ? null : Math.trunc(n)
}

/**
 * Merge `keyframeUrl` (no dedicated column) into rawMeta so it isn't lost.
 */
function mergeRawMeta(item: CompetitorIngestItem): Record<string, unknown> | null {
  // Only spread plain objects — `typeof [] === 'object'`, so an array rawMeta
  // would be corrupted into `{0:.., 1:..}`. Keep an array payload under a key.
  const raw = item.rawMeta
  const base: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : raw !== null && raw !== undefined
        ? { _raw: raw }
        : {}
  if (item.keyframeUrl) base.keyframeUrl = item.keyframeUrl
  return Object.keys(base).length ? base : null
}

type JsonField = Prisma.InputJsonValue | undefined

/** Prisma create/update payload shape shared by both. */
export interface CompetitorCreativeFields {
  appName: string | null
  advertiser: string | null
  mediaPlatforms: JsonField
  adFormat: string | null
  region: string | null
  language: string | null
  level: string | null
  adDays: number | null
  impressions: bigint | null
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  originalPostUrl: string | null
  ratio: string | null
  duration: number | null
  creativeTags: JsonField
  sellingPoints: JsonField
  emotionalTriggers: JsonField
  screenUnderstanding: JsonField
  storyboard: JsonField
  transcript: string | null
  bgm: string | null
  aiPrompt: string | null
  segmentPlan: JsonField
  rawMeta: JsonField
}

function asJson(value: unknown): JsonField {
  return value === null || value === undefined ? undefined : (value as Prisma.InputJsonValue)
}

/** Map a parsed ingest item to the Prisma field set (excludes id/org/assetId). */
export function mapCompetitorItemToFields(item: CompetitorIngestItem): CompetitorCreativeFields {
  return {
    appName: item.appName ?? null,
    advertiser: item.advertiser ?? null,
    mediaPlatforms: asJson(item.mediaPlatforms),
    adFormat: item.adFormat ?? null,
    region: item.region ?? null,
    language: item.language ?? null,
    level: item.level ?? null,
    adDays: parseAdDays(item.adDays),
    impressions: parseImpressions(item.impressions),
    firstSeenAt: parseDate(item.firstSeenAt),
    lastSeenAt: parseDate(item.lastSeenAt),
    originalPostUrl: item.originalPostUrl ?? null,
    ratio: item.ratio ?? null,
    duration: item.duration ?? null,
    creativeTags: asJson(item.creativeTags),
    sellingPoints: asJson(item.sellingPoints),
    emotionalTriggers: asJson(item.emotionalTriggers),
    screenUnderstanding: asJson(item.screenUnderstanding),
    storyboard: asJson(item.storyboard),
    transcript: item.transcript ?? null,
    bgm: item.bgm ?? null,
    aiPrompt: item.aiPrompt ?? null,
    segmentPlan: asJson(item.segmentPlan),
    rawMeta: asJson(mergeRawMeta(item)),
  }
}
