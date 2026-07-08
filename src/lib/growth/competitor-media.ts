/**
 * Competitor media → Adex GCS (Tier-1 preview thumbnails by default; full video gated).
 *
 * Wired into the competitor ingest pipeline: after upserting a `CompetitorCreative`,
 * the ingest route calls `storeCompetitorMedia(posterUrl, { orgId, externalId })` to
 * persist a small preview image for the competitor-intel panel.
 *
 * Policy (docs/growth/06-poc-run-01.md §10): Tier-1 = images only, size-capped, stored
 * by default. Full VIDEO storage is OFF unless `allowVideo` is passed — reserve it for
 * hand-picked winners sourced from a public Original Post or an in-plan download, never
 * bulk-scraped, and never reused as our own material or as a generation reference (that
 * would be the "copy" we design against).
 *
 * Ref: src/lib/storage.ts (uploadToGCS) · docs/growth/06-competitor-intel-remix.md §4-6
 */

import { uploadToGCS } from '@/lib/storage'

export type MediaKind = 'thumbnail' | 'poster' | 'video'

/** Preview images are capped so a bad URL can't pull a huge file into the bucket. */
export const THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024 // 3MB

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
    return
  }
  if (!ct.startsWith('image/')) throw new Error(`Tier-1 (${kind}) stores images only, got "${contentType}".`)
  if (bytes > THUMBNAIL_MAX_BYTES) throw new Error(`Preview image is ${bytes}B, over the ${THUMBNAIL_MAX_BYTES}B cap.`)
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
  const buffer = Buffer.from(await res.arrayBuffer())

  assertStorable(kind, contentType, buffer.length, opts.allowVideo)

  const filename = competitorMediaKey(opts.orgId, opts.externalId, kind, contentType)
  const gcsUrl = await uploadToGCS(buffer, filename, contentType)
  return { gcsUrl, bytes: buffer.length, contentType, kind }
}
