/**
 * POST /api/competitors/media — Tier-2: store a vetted competitor creative's full
 * VIDEO to Adex GCS (legal-cleared 2026-07-09). Deliberate + per-winner, NOT bulk:
 * the caller passes the specific creative id and a fresh public/vetted `sourceUrl`
 * (Original Post or in-plan download — AppGrowing CDN links are signed/expiring).
 *
 * Guardrails (docs/growth/06-competitor-intel-remix.md §6): `allowVideo` gate +
 * VIDEO_MAX_BYTES cap + SSRF check + audit trail. The stored video is reference/
 * intel only — it is NEVER fed to generation (the remix stays text2video), so it
 * cannot become the "copy" we design against.
 *
 * Body: { competitorCreativeId, sourceUrl }
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { storeCompetitorMedia, isPublicHttpUrl } from '@/lib/growth/competitor-media'

export async function POST(req: NextRequest) {
  let user, orgId: string
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    orgId = ctx.org.id
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { competitorCreativeId, sourceUrl } = await req.json()
    if (!competitorCreativeId || typeof sourceUrl !== 'string') {
      return NextResponse.json({ error: 'competitorCreativeId and sourceUrl are required' }, { status: 400 })
    }
    if (!isPublicHttpUrl(sourceUrl)) {
      return NextResponse.json({ error: 'sourceUrl must be a public http(s) URL' }, { status: 400 })
    }

    const cc = await prisma.competitorCreative.findFirst({
      where: { id: competitorCreativeId, orgId },
      select: { id: true, externalId: true, appName: true, ratio: true, duration: true, assetId: true },
    })
    if (!cc) {
      return NextResponse.json({ error: 'Competitor creative not found' }, { status: 404 })
    }

    // Idempotent: one Tier-2 video Asset per competitor creative.
    const dedupKey = `appgrowing:${cc.externalId}:video`
    const existing = await prisma.asset.findFirst({
      where: { orgId, source: 'appgrowing', driveFileId: dedupKey },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ asset: { id: existing.id }, deduped: true })
    }

    // Fetch + store — allowVideo:true (legal-cleared), capped in storeCompetitorMedia.
    const stored = await storeCompetitorMedia(sourceUrl, {
      orgId,
      externalId: cc.externalId,
      kind: 'video',
      allowVideo: true,
    })

    const asset = await prisma.asset.create({
      data: {
        orgId,
        uploadedBy: user.id,
        uploaderName: user.name || user.email,
        name: (cc.appName ?? 'Competitor creative').slice(0, 80),
        type: 'video',
        source: 'appgrowing',
        fileUrl: stored.gcsUrl,
        status: 'ready',
        fileSize: stored.bytes,
        ratio: cc.ratio,
        duration: cc.duration,
        driveFileId: dedupKey,
        tags: JSON.stringify(['appgrowing', 'competitor', 'tier2-video']),
      },
    })
    await prisma.competitorCreative.update({ where: { id: cc.id }, data: { assetId: asset.id } })

    // IP-sensitive op → provenance trail (R1).
    await logAudit({
      orgId,
      userId: user.id,
      action: 'competitor.video_store',
      targetType: 'CompetitorCreative',
      targetId: cc.id,
      metadata: { externalId: cc.externalId, bytes: stored.bytes, contentType: stored.contentType, host: new URL(sourceUrl).host },
      req,
    })

    return NextResponse.json({ asset })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tier-2 store failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
