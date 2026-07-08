import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { verifyHmac } from '@/lib/growth/ingest-auth'
import { parseCompetitorBatch, type NormalizedCompetitor } from '@/lib/growth/competitor-import'
import { uploadToGCS } from '@/lib/storage'
import { VIDEO_MAX_BYTES } from '@/lib/growth/competitor-media'

/**
 * POST /api/ingest/competitor?org=<orgId>
 *
 * Ingest a batch of competitor creatives captured from AppGrowing via the
 * non-API "Approach B" path (authenticated export / Collections / browser
 * plugin) — NOT the internal GraphQL scrape (ToS-risky; §5 Approach C). The
 * batch carries two tiers (discovery + enriched); rows the relevance filter
 * flags as off-target keyword false-matches are dropped. Idempotent upsert by
 * (orgId, source, externalId). For enriched rows that carry a media URL we
 * fetch it, push it to GCS, and link an Asset(source='appgrowing').
 *
 * Auth: HMAC-SHA256 over the raw body keyed on the org's ingest secret
 * (PlatformAuth platform='ingest', env INGEST_WEBHOOK_SECRET fallback) with a
 * timestamp replay window — cloned from ingest/scenes + ingest/events. Headers:
 * X-Adex-Timestamp, X-Adex-Signature.
 *
 * Ref: docs/growth/06-competitor-intel-remix.md §4–5
 */
export async function POST(req: NextRequest) {
  const orgId = new URL(req.url).searchParams.get('org')
  if (!orgId) return NextResponse.json({ error: 'missing ?org' }, { status: 400 })

  // Reject unsigned callers up front, before any DB work — an unsigned request
  // can never be authorized, and this keeps the rejection independent of org
  // existence (no oracle) and of DB availability.
  const timestamp = req.headers.get('x-adex-timestamp')
  const signature = req.headers.get('x-adex-signature')
  if (!timestamp || !signature) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rawBody = await req.text()

  let secret: string | undefined = process.env.INGEST_WEBHOOK_SECRET
  try {
    const auth = await prisma.platformAuth.findUnique({
      where: { orgId_platform: { orgId, platform: 'ingest' } },
    })
    if (auth?.apiKey) secret = auth.apiKey
  } catch {
    // fall through to env fallback
  }

  if (!verifyHmac({ secret, timestamp, signature, rawBody })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { source, rows } = parseCompetitorBatch(payload)
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, created: 0, updated: 0, filtered: 0, assets: 0, total: 0 })
  }

  let created = 0
  let updated = 0
  let filtered = 0
  let assets = 0

  for (const row of rows) {
    if (row.verdict === 'drop') {
      filtered++
      continue
    }

    const where: Prisma.CompetitorCreativeWhereUniqueInput = {
      orgId_source_externalId: { orgId, source, externalId: row.externalId },
    }
    const existing = await prisma.competitorCreative.findUnique({
      where,
      select: { id: true, assetId: true },
    })

    // Enriched rows with a usable media URL get their media pulled into GCS +
    // an Asset. Reuse a prior upload; a media failure must never fail the
    // whole ingest (surface-as-null, keep the intel row).
    let assetId = existing?.assetId ?? null
    if (row.tier === 'enriched' && !assetId && row.mediaUrl) {
      const uploaded = await fetchMediaToAsset(orgId, row)
      if (uploaded) {
        assetId = uploaded
        assets++
      }
    }

    const data = toData(row, orgId, source, assetId)
    if (existing) {
      await prisma.competitorCreative.update({ where, data })
      updated++
    } else {
      await prisma.competitorCreative.create({ data })
      created++
    }
  }

  return NextResponse.json({ ok: true, created, updated, filtered, assets, total: rows.length })
}

/** Build the Prisma payload. Hard metadata is refreshed on every re-ingest
 *  (ad-days / impressions legitimately grow over time). The AI-enrichment layer
 *  — the expensive cached analysis — is set only when present, so a lighter
 *  re-ingest of the same externalId never wipes a prior enrichment, and we never
 *  pass a raw `null` to a Prisma Json column (which needs JsonNull/DbNull). */
function toData(
  row: NormalizedCompetitor,
  orgId: string,
  source: string,
  assetId: string | null,
): Prisma.CompetitorCreativeUncheckedCreateInput {
  const d: Prisma.CompetitorCreativeUncheckedCreateInput = {
    orgId,
    source,
    externalId: row.externalId,
    relevance: row.relevance,
    appName: row.appName,
    advertiser: row.advertiser,
    adFormat: row.adFormat,
    region: row.region,
    language: row.language,
    adDays: row.adDays,
    impressions: row.impressions,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    originalPostUrl: row.originalPostUrl,
    ratio: row.ratio,
    duration: row.duration,
    assetId,
  }
  // AI-enrichment layer — preserve prior analysis when a re-ingest omits it.
  if (row.aiPrompt != null) d.aiPrompt = row.aiPrompt
  if (row.transcript != null) d.transcript = row.transcript
  if (row.bgm != null) d.bgm = row.bgm
  if (row.mediaPlatforms) d.mediaPlatforms = asJson(row.mediaPlatforms)
  if (row.creativeTags) d.creativeTags = asJson(row.creativeTags)
  if (row.sellingPoints) d.sellingPoints = asJson(row.sellingPoints)
  if (row.emotionalTriggers) d.emotionalTriggers = asJson(row.emotionalTriggers)
  if (row.screenUnderstanding) d.screenUnderstanding = asJson(row.screenUnderstanding)
  if (row.storyboard) d.storyboard = asJson(row.storyboard)
  if (row.rawMeta) d.rawMeta = asJson(row.rawMeta)
  return d
}

/** Narrow a JSON-parsed value to Prisma's Json input type (data is already
 *  JSON, having arrived via JSON.parse of the request body). */
function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue
}

/** Fetch an enriched row's media, push it to GCS, and create/link an Asset.
 *  Deduped by a stable external key (mirrors src/app/api/assets/sync dedup).
 *  Returns the Asset id, or null on any failure (kept resilient). */
async function fetchMediaToAsset(orgId: string, row: NormalizedCompetitor): Promise<string | null> {
  const url = row.mediaUrl
  if (!url) return null
  // Reuse `driveFileId` as the generic external-dedup key. It is isolated by
  // source='appgrowing', so it never collides with the Google-Drive sync which
  // always filters source='gdrive'.
  const dedupKey = `appgrowing:${row.externalId}`
  try {
    const existing = await prisma.asset.findFirst({
      where: { orgId, source: 'appgrowing', driveFileId: dedupKey },
      select: { id: true },
    })
    if (existing) return existing.id

    const res = await fetch(url)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const isVideo = contentType.startsWith('video')
    // Bulk ingest is bounded: skip an over-cap video (by declared length) before we
    // buffer it. Vetted winners above the cap go through POST /api/competitors/media.
    if (isVideo && Number(res.headers.get('content-length') ?? 0) > VIDEO_MAX_BYTES) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length === 0) return null
    if (isVideo && buffer.length > VIDEO_MAX_BYTES) return null
    // orgId + externalId are caller-supplied (HMAC-gated but still external) and
    // flow into the GCS object key — sanitize each segment so a hostile/malformed
    // value can't inject path separators or produce a broken public URL.
    const filename = `appgrowing/${safeSegment(orgId)}/${safeSegment(row.externalId)}${extForContentType(contentType)}`
    const fileUrl = await uploadToGCS(buffer, filename, contentType)

    const asset = await prisma.asset.create({
      data: {
        orgId,
        uploadedBy: 'appgrowing-ingest',
        uploaderName: 'AppGrowing',
        name: (row.appName ?? 'Competitor creative').slice(0, 80),
        type: isVideo ? 'video' : 'image',
        source: 'appgrowing',
        fileUrl,
        status: 'ready',
        fileSize: buffer.length,
        ratio: row.ratio,
        duration: row.duration,
        driveFileId: dedupKey,
        tags: JSON.stringify(['appgrowing', 'competitor']),
      },
    })
    return asset.id
  } catch {
    return null
  }
}

function extForContentType(ct: string): string {
  if (ct.includes('mp4')) return '.mp4'
  if (ct.includes('webm')) return '.webm'
  if (ct.includes('quicktime')) return '.mov'
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg'
  if (ct.includes('png')) return '.png'
  if (ct.includes('gif')) return '.gif'
  if (ct.includes('webp')) return '.webp'
  return ''
}

/** Reduce an arbitrary string to a safe GCS object-key segment: only
 *  [A-Za-z0-9._-], no leading dots (blocks '.'/'..'), length-capped. */
function safeSegment(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_').slice(0, 120)
  return cleaned || 'x'
}
