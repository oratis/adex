/**
 * Competitor media → Adex GCS (Tier-1 preview thumbnails by default; full video gated).
 *
 * Wired into the competitor ingest pipeline: after upserting a `CompetitorCreative`,
 * the ingest route calls `storeCompetitorMedia(posterUrl, { orgId, externalId })` to
 * persist a small preview image for the competitor-intel panel.
 *
 * Policy (docs/growth/06-poc-run-01.md §10; Tier-2 legal-cleared 2026-07-09): Tier-1 =
 * images only, size-capped, stored by default. Tier-2 = full VIDEO — now legal-approved
 * but still DELIBERATE: OFF unless `allowVideo` is passed, size-capped at VIDEO_MAX_BYTES,
 * reserved for hand-picked winners from a public Original Post / in-plan download, never
 * bulk-scraped, and NEVER reused as our own material or as a generation reference (that
 * would be the "copy" we design against — the remix stays text2video).
 *
 * Ref: src/lib/storage.ts (uploadToGCS) · docs/growth/06-competitor-intel-remix.md §4-6
 */

import { uploadToGCS } from '@/lib/storage'

export type MediaKind = 'thumbnail' | 'poster' | 'video'

/** Preview images are capped so a bad URL can't pull a huge file into the bucket. */
export const THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024 // 3MB
/** Tier-2 full-video cap (legal-cleared 2026-07-09) — bounds each per-winner download. */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024 // 50MB

export interface StoredCompetitorMedia {
  gcsUrl: string
  bytes: number
  contentType: string
  kind: MediaKind
}

const EXT_BY_CT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

/** File extension for a content-type (ignores charset/params); `bin` when unknown. */
export function extForContentType(contentType: string): string {
  const ct = contentType.split(';')[0].trim().toLowerCase()
  return EXT_BY_CT[ct] ?? 'bin'
}

/**
 * Deterministic, dedupable object name (the `filename` for uploadToGCS, which nests it
 * under GCS_UPLOAD_PREFIX). Same competitor creative + kind → same path → overwrite, not
 * duplicate. externalId is sanitised so it can't escape the path.
 */
export function competitorMediaKey(
  orgId: string,
  externalId: string,
  kind: MediaKind,
  contentType: string,
): string {
  const safeOrg = orgId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeId = externalId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `competitors/${safeOrg}/${kind}/${safeId}.${extForContentType(contentType)}`
}

/**
 * Policy gate — throws if this media isn't allowed under its tier.
 * - image kinds (thumbnail/poster): must be image/*, within the size cap.
 * - video: rejected unless `allowVideo` is explicitly true (ToS/IP), and must be video/*.
 */
export function assertStorable(kind: MediaKind, contentType: string, bytes: number, allowVideo = false): void {
  const ct = contentType.split(';')[0].trim().toLowerCase()
  if (kind === 'video') {
    if (!allowVideo) {
      throw new Error('Competitor video storage is disabled by default (ToS/IP). Pass allowVideo only for vetted, publicly-sourced winners.')
    }
    if (!ct.startsWith('video/')) throw new Error(`Expected a video content-type for kind=video, got "${contentType}".`)
    if (bytes > VIDEO_MAX_BYTES) throw new Error(`Competitor video is ${bytes}B, over the ${VIDEO_MAX_BYTES}B Tier-2 cap.`)
    return
  }
  if (!ct.startsWith('image/')) throw new Error(`Tier-1 (${kind}) stores images only, got "${contentType}".`)
  if (bytes > THUMBNAIL_MAX_BYTES) throw new Error(`Preview image is ${bytes}B, over the ${THUMBNAIL_MAX_BYTES}B cap.`)
}

/**
 * SSRF guard for caller-supplied media URLs — this module fetches them server-side.
 * Allows only http(s) to a non-private host (blocks loopback, link-local, RFC-1918,
 * and the GCP metadata host).
 */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h === 'metadata.google.internal') return false
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|::1$)/.test(h)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
  return true
}

/**
 * Fetch a competitor media URL and store it to Adex GCS. Thumbnails/posters by default;
 * video only with `allowVideo`. Returns the stored object's public URL + metadata.
 * Throws on fetch failure or a policy violation (caller decides how to surface it).
 */
export async function storeCompetitorMedia(
  sourceUrl: string,
  opts: { orgId: string; externalId: string; kind?: MediaKind; allowVideo?: boolean },
): Promise<StoredCompetitorMedia> {
  const kind = opts.kind ?? 'thumbnail'
  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`Fetch competitor media failed (${res.status}) for ${opts.externalId}`)
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
  // Cheap pre-check: reject an over-cap video from its declared length before we buffer
  // the whole file into memory. The post-download assert still enforces the real size.
  if (kind === 'video') {
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > VIDEO_MAX_BYTES) {
      throw new Error(`Competitor video declares ${declared}B, over the ${VIDEO_MAX_BYTES}B Tier-2 cap.`)
    }
  }
  const buffer = Buffer.from(await res.arrayBuffer())

  assertStorable(kind, contentType, buffer.length, opts.allowVideo)

  const filename = competitorMediaKey(opts.orgId, opts.externalId, kind, contentType)
  const gcsUrl = await uploadToGCS(buffer, filename, contentType)
  return { gcsUrl, bytes: buffer.length, contentType, kind }
}
