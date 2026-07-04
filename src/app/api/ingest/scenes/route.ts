import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyHmac } from '@/lib/growth/ingest-auth'
import { parseScenes, tagScenes, mapSceneToCreative } from '@/lib/growth/scene-import'

/**
 * POST /api/ingest/scenes?org=<orgId>
 *
 * Cuddler pushes shared-scene metadata; we import each as a review-gated
 * Creative (source=imported_scene) with LLM/fallback tags. Idempotent by
 * (orgId, sourceRef). Auth: HMAC over the raw body (org's 'ingest' secret).
 *
 * Imported creatives are reviewStatus=pending — they must pass the existing
 * creatives/review flow before any push to a platform (IP/authorization gate).
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §6
 */
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

  const scenes = parseScenes(payload)
  if (scenes.length === 0) return NextResponse.json({ ok: true, imported: 0 })

  const tags = await tagScenes(scenes)

  let imported = 0
  let skipped = 0
  for (const scene of scenes) {
    const exists = await prisma.creative.findFirst({
      where: { orgId, sourceRef: scene.id, source: 'imported_scene' },
      select: { id: true },
    })
    if (exists) { skipped++; continue }
    await prisma.creative.create({
      data: mapSceneToCreative(scene, { orgId, userId: org.createdBy }, tags.get(scene.id)),
    })
    imported++
  }

  return NextResponse.json({ ok: true, imported, skipped })
}
