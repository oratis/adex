import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyHmac } from '@/lib/growth/ingest-auth'
import { uploadToGCS } from '@/lib/storage'
import {
  APPGROWING_SOURCE,
  parseCompetitorItems,
  isOwnGcsUrl,
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

function guessAssetType(url: string): string {
  return IMAGE_EXT_RE.test(url) ? 'image' : 'video'
}

async function ensureAsset(
  item: CompetitorIngestItem,
  ctx: { orgId: string; uploadedBy: string },
): Promise<string | null> {
  const mediaUrl = item.mediaUrl
  if (!mediaUrl) return null

  if (isOwnGcsUrl(mediaUrl)) {
    const asset = await prisma.asset.create({
      data: {
        orgId: ctx.orgId,
        uploadedBy: ctx.uploadedBy,
        name: item.appName || `Competitor ${item.externalId}`,
        type: guessAssetType(mediaUrl),
        source: APPGROWING_SOURCE,
        fileUrl: mediaUrl,
        status: 'ready',
        ratio: item.ratio ?? undefined,
        duration: item.duration ?? undefined,
      },
    })
    return asset.id
  }

  const res = await fetch(mediaUrl)
  if (!res.ok) throw new Error(`fetch mediaUrl failed (${res.status})`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  const ext = guessAssetType(mediaUrl) === 'image' ? 'jpg' : 'mp4'
  const filename = `competitor/${item.externalId}-${Date.now()}.${ext}`
  const fileUrl = await uploadToGCS(buffer, filename, contentType)

  const asset = await prisma.asset.create({
    data: {
      orgId: ctx.orgId,
      uploadedBy: ctx.uploadedBy,
      name: item.appName || `Competitor ${item.externalId}`,
      type: guessAssetType(mediaUrl),
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
