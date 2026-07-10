/**
 * POST /api/creatives/remix — the competitor-remix 合龙.
 *   competitorCreative (Phase 1 ingest) → buildRemixBrief (borrow-structure-not-copy)
 *   → Seedance2 text2video (render seam fixed in #8) → review-gated Creative.
 *
 * GET /api/creatives/remix?creativeId=&assetId= — poll the render and, when the
 * Ark task succeeds, promote the video URL onto the Creative (it stays
 * reviewStatus:'pending' — nothing ships before the human review gate).
 *
 * Ref: docs/growth/06-competitor-intel-remix.md §3.2 · src/lib/growth/remix-brief.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { Seedance2Client, assetUpdateFromTask } from '@/lib/platforms/seedance2'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import {
  buildRemixBrief,
  competitorCreativeToAnalysis,
  remixBriefToSeedanceRequest,
  type ProductBrief,
  type Ratio,
} from '@/lib/growth/remix-brief'

const SEEDANCE2_API_KEY = process.env.SEEDANCE2_API_KEY || ''
// Cost guardrails (R3): burst limit + per-org daily cap on paid Seedance2 renders.
const REMIX_BURST_LIMIT = Number(process.env.REMIX_BURST_LIMIT || 20)
const REMIX_DAILY_CAP = Number(process.env.REMIX_DAILY_CAP || 50)

function ratioDims(ratio: Ratio): { width: number; height: number } {
  switch (ratio) {
    case '16:9': return { width: 1280, height: 720 }
    case '1:1': return { width: 1080, height: 1080 }
    case '4:3': return { width: 1440, height: 1080 }
    case '3:4': return { width: 1080, height: 1440 }
    case '9:16':
    default: return { width: 720, height: 1280 }
  }
}

export async function POST(req: NextRequest) {
  let user, org
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Cost guardrails before any paid work: burst limit + per-org daily cap.
    const rl = checkRateLimit(req, { key: 'remix', limit: REMIX_BURST_LIMIT, windowMs: 600_000, identity: org.id })
    if (!rl.ok) return rateLimitResponse(rl)
    const since = new Date()
    since.setHours(0, 0, 0, 0)
    const todayCount = await prisma.creative.count({
      where: { orgId: org.id, source: 'remix', createdAt: { gte: since } },
    })
    if (todayCount >= REMIX_DAILY_CAP) {
      return NextResponse.json(
        { error: `Daily remix cap reached (${REMIX_DAILY_CAP}). Resets at midnight.` },
        { status: 429 },
      )
    }

    const body = await req.json()
    const { competitorCreativeId, product, positioning, audience, artDirection, cta, differentiation, forbidden } = body

    if (!competitorCreativeId) {
      return NextResponse.json({ error: 'competitorCreativeId is required' }, { status: 400 })
    }
    if (!product || !positioning) {
      return NextResponse.json({ error: 'product and positioning are required' }, { status: 400 })
    }

    const cc = await prisma.competitorCreative.findFirst({
      where: { id: competitorCreativeId, orgId: org.id },
    })
    if (!cc) {
      return NextResponse.json({ error: 'Competitor creative not found' }, { status: 404 })
    }

    // Map the ingested competitor row → analysis (screenUnderstanding rides along
    // only as the anti-reference; the remix never reproduces it).
    const analysis = competitorCreativeToAnalysis(cc)
    const productBrief: ProductBrief = {
      product,
      positioning,
      audience: audience ?? '',
      artDirection: artDirection ?? 'warm, brand-appropriate art direction',
      cta: cta ?? 'Learn more',
      differentiation: differentiation ?? null,
      forbidden: Array.isArray(forbidden) ? forbidden.map(String) : null,
    }

    const brief = await buildRemixBrief(analysis, productBrief)
    const gen = remixBriefToSeedanceRequest(brief)

    // Kick off the render (text2video — no competitor pixels).
    const client = new Seedance2Client({ apiKey: SEEDANCE2_API_KEY })
    const task = await client.textToVideo({
      prompt: gen.prompt,
      ratio: gen.ratio,
      duration: gen.duration,
      generateAudio: gen.generateAudio,
    })

    const dims = ratioDims(brief.ratio)
    // Review-gated ad (the thing a human approves before any push).
    const creative = await prisma.creative.create({
      data: {
        orgId: org.id,
        userId: user.id,
        name: `${productBrief.product} remix — ${brief.sourceRef}`.slice(0, 80),
        type: 'video',
        source: 'remix',
        prompt: brief.seedance2Prompt,
        sourceRef: cc.externalId,
        tags: JSON.stringify({ borrowed: brief.borrowed, changed: brief.changed, compliance: brief.compliance }),
        status: 'generating',
        reviewStatus: 'pending',
        width: dims.width,
        height: dims.height,
        duration: brief.durationSec,
      },
    })
    // Render tracker — driven by the fixed Seedance2 status seam.
    const asset = await prisma.asset.create({
      data: {
        orgId: org.id,
        uploadedBy: user.id,
        uploaderName: user.name || user.email,
        name: `Remix render — ${brief.sourceRef}`,
        type: 'video',
        source: 'remix',
        prompt: brief.seedance2Prompt,
        referenceData: JSON.stringify({ competitorCreativeId: cc.id, creativeId: creative.id, sourceRef: cc.externalId }),
        taskId: task.id,
        status: 'generating',
        ratio: brief.ratio,
        duration: brief.durationSec,
        model: 'doubao-seedance-2-0-260128',
      },
    })

    return NextResponse.json({ creative, asset, brief, task })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Remix failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  let org
  try {
    org = (await requireAuthWithOrg()).org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const creativeId = req.nextUrl.searchParams.get('creativeId')
  const assetId = req.nextUrl.searchParams.get('assetId')
  if (!creativeId || !assetId) {
    return NextResponse.json({ error: 'creativeId and assetId are required' }, { status: 400 })
  }

  try {
    const [asset, creative] = await Promise.all([
      prisma.asset.findFirst({ where: { id: assetId, orgId: org.id } }),
      prisma.creative.findFirst({ where: { id: creativeId, orgId: org.id } }),
    ])
    if (!asset || !creative) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!asset.taskId) {
      return NextResponse.json({ creative, asset })
    }

    const client = new Seedance2Client({ apiKey: SEEDANCE2_API_KEY })
    const task = await client.getTask(asset.taskId)
    const update = assetUpdateFromTask(task)

    let updatedAsset = asset
    let updatedCreative = creative
    if (Object.keys(update).length > 0) {
      updatedAsset = await prisma.asset.update({ where: { id: asset.id }, data: update })
      // Promote the finished render onto the Creative — but keep it review-gated.
      if (update.status === 'ready' && typeof update.fileUrl === 'string') {
        updatedCreative = await prisma.creative.update({
          where: { id: creative.id },
          data: { status: 'ready', fileUrl: update.fileUrl },
        })
      } else if (update.status === 'failed') {
        updatedCreative = await prisma.creative.update({
          where: { id: creative.id },
          data: { status: 'failed' },
        })
      }
    }

    return NextResponse.json({ creative: updatedCreative, asset: updatedAsset, taskStatus: task.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Status check failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
