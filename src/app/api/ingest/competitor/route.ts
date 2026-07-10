import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyHmac } from '@/lib/growth/ingest-auth'
import { isOwnGcsUrl, uploadFromUrl } from '@/lib/storage'
import {
  APPGROWING_SOURCE,
  parseCompetitorItems,
  mapCompetitorItemToFields,
  type CompetitorIngestItem,
} from '@/lib/platforms/appgrowing'

/**
 * POST /api/ingest/competitor?org=<orgId>
 *
 * Local creative-pipeline (or any AppGrowing bridge) pushes competitor ad
 * creative metadata + AI analysis; we upsert each as a CompetitorCreative
 * row, idempotent by (orgId, source, externalId). `mediaUrl` already on our
 * GCS bucket is linked directly (no re-fetch); external URLs are fetched
 * once and uploaded to GCS. Auth mirrors ingest/scenes: HMAC over the raw
 * body using the org's 'ingest' PlatformAuth apiKey.
 *
 * Ref: docs/growth/09-pipeline-adex-integration.md §3
 */

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(\?|$)/i
const MAX_INGEST_ITEMS = 50

/** image vs video, preferring the response content-type over the URL extension. */
function assetType(url: string, contentType?: string): string {
  if (contentType) {
    if (contentType.startsWith('image/')) return 'image'
    if (contentType.startsWith('video/')) return 'video'
  }
  return IMAGE_EXT_RE.test(url) ? 'image' : 'video'
}

async function ensureAsset(
  item: CompetitorIngestItem,
  ctx: { orgId: string; uploadedBy: string },
): Promise<string | null> {
  const mediaUrl = item.mediaUrl
  if (!mediaUrl) return null

  // Already hosted in our own bucket → link directly, no re-fetch.
  // External URL → SSRF/size-guarded fetch + upload (see storage.uploadFromUrl).
  let fileUrl: string
  let type: string
  if (isOwnGcsUrl(mediaUrl)) {
    fileUrl = mediaUrl
    type = assetType(mediaUrl)
  } else {
    const ext = IMAGE_EXT_RE.test(mediaUrl) ? 'jpg' : 'mp4'
    const filename = `competitor/${item.externalId}-${Date.now()}.${ext}`
    const uploaded = await uploadFromUrl(mediaUrl, filename)
    fileUrl = uploaded.fileUrl
    type = assetType(mediaUrl, uploaded.contentType)
  }

  const asset = await prisma.asset.create({
    data: {
      orgId: ctx.orgId,
      uploadedBy: ctx.uploadedBy,
      name: item.appName || `Competitor ${item.externalId}`,
      type,
      source: APPGROWING_SOURCE,
      fileUrl,
      status: 'ready',
      ratio: item.ratio ?? undefined,
      duration: item.duration ?? undefined,
    },
  })
  return asset.id
}

export async function POST(req: NextRequest) {
  const orgId = new URL(req.url).searchParams.get('org')
  if (!orgId) return NextResponse.json({ error: 'missing ?org' }, { status: 400 })

  const rawBody = await req.text()

  let secret: string | undefined = process.env.INGEST_WEBHOOK_SECRET
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { createdBy: true } })
  if (!org) return NextResponse.json({ error: 'unknown org' }, { status: 404 })
  try {
    const auth = await prisma.platformAuth.findUnique({ where: { orgId_platform: { orgId, platform: 'ingest' } } })
    if (auth?.apiKey) secret = auth.apiKey
  } catch {
    // env fallback
  }

  if (!verifyHmac({ secret, timestamp: req.headers.get('x-adex-timestamp'), signature: req.headers.get('x-adex-signature'), rawBody })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const items = parseCompetitorItems(payload)
  if (items.length === 0) return NextResponse.json({ ok: true, results: [] })
  // Each item may trigger a media fetch+upload; a large batch in one request
  // path risks Cloud Run's request timeout. Cap it — larger pushes should be
  // chunked by the caller (or run via the pipeline worker, docs 09 §1).
  if (items.length > MAX_INGEST_ITEMS) {
    return NextResponse.json(
      { error: `too many items (${items.length} > ${MAX_INGEST_ITEMS}); chunk the batch` },
      { status: 413 },
    )
  }

  const results: Array<{ externalId: string; status: 'created' | 'updated' | 'failed'; id?: string; error?: string }> = []

  for (const item of items) {
    try {
      const existing = await prisma.competitorCreative.findUnique({
        where: { orgId_source_externalId: { orgId, source: APPGROWING_SOURCE, externalId: item.externalId } },
      })

      const assetId = existing?.assetId
        ? existing.assetId
        : await ensureAsset(item, { orgId, uploadedBy: org.createdBy })

      const fields = mapCompetitorItemToFields(item)

      if (existing) {
        const updated = await prisma.competitorCreative.update({
          where: { id: existing.id },
          data: { ...fields, assetId: assetId ?? existing.assetId },
        })
        results.push({ externalId: item.externalId, status: 'updated', id: updated.id })
      } else {
        const created = await prisma.competitorCreative.create({
          data: {
            orgId,
            source: APPGROWING_SOURCE,
            externalId: item.externalId,
            assetId: assetId ?? undefined,
            ...fields,
          },
        })
        results.push({ externalId: item.externalId, status: 'created', id: created.id })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ingest failed'
      results.push({ externalId: item.externalId, status: 'failed', error: message })
    }
  }

  return NextResponse.json({ ok: true, results })
}
