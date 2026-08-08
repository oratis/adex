/**
 * POST /api/creatives/remix-jobs — competitor-remix, worker-engine path.
 *   competitorCreative (Phase 1 ingest) → buildRemixBrief (borrow-structure-not-copy)
 *   → RemixJob(status:'pending') + review-gated Creative(status:'generating').
 *
 * Unlike POST /api/creatives/remix (the Seedance2-direct single-shot path), this
 * route does NOT call any video-generation API — it only builds the brief and
 * persists the job. An external worker (separate Cloud Run Job repo) claims the
 * job via /api/worker/remix-jobs/claim, generates each storyboard beat, assembles
 * the clip, QCs it, and reports progress/results back via /api/worker/remix-jobs/report
 * + /upload.
 *
 * GET /api/creatives/remix-jobs?id=<jobId> — single job (org-scoped, 404 if not
 * found/foreign), with a summary of the linked Creative attached.
 * GET /api/creatives/remix-jobs — recent jobs list (take 30, newest first).
 *
 * Ref: src/app/api/creatives/remix/route.ts (sibling single-shot path) ·
 * src/lib/growth/remix-brief.ts · src/lib/growth/remix-job.ts (worker-side helpers)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'
import {
  buildRemixBrief,
  competitorCreativeToAnalysis,
  type ProductBrief,
} from '@/lib/growth/remix-brief'
import { asJson, workerCanvasDims, KNOWN_TIERS, parseEnabledTiers, parseSegmentPlan } from '@/lib/growth/remix-job'

// Cost guardrails (mirrors /api/creatives/remix): burst limit + per-org daily cap.
const REMIX_BURST_LIMIT = Number(process.env.REMIX_BURST_LIMIT || 20)
const REMIX_DAILY_CAP = Number(process.env.REMIX_DAILY_CAP || 50)

// Tier codes exist for t1/t2 but stay behind an explicit opt-in — see
// REMIX_ENABLED_TIERS (parseEnabledTiers, default 't0_5' only). This keeps the
// shipped default identical to the current IP policy: borrow-structure-not-pixels.
type SupportedTier = (typeof KNOWN_TIERS)[number]

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
    // Cost guardrails before any work: burst limit + per-org daily cap. Rate-limit
    // key is 'remix' — shared with the sibling /api/creatives/remix (Seedance2-direct)
    // endpoint, not a per-route key, so a caller hitting both endpoints can't double
    // the effective burst by splitting requests across the two.
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
    const { competitorCreativeId, tier, product, positioning, audience, artDirection, cta, differentiation, forbidden, segmentPlan: rawSegmentPlan } = body

    if (!competitorCreativeId) {
      return NextResponse.json({ error: 'competitorCreativeId is required' }, { status: 400 })
    }
    if (!product || !positioning) {
      return NextResponse.json({ error: 'product and positioning are required' }, { status: 400 })
    }
    const resolvedTier: SupportedTier = tier === undefined ? 't0_5' : tier
    if (!(KNOWN_TIERS as readonly string[]).includes(resolvedTier)) {
      return NextResponse.json(
        { error: `Unsupported tier "${tier}" — must be one of ${KNOWN_TIERS.join(', ')}` },
        { status: 400 },
      )
    }
    const enabledTiers = parseEnabledTiers()
    if (!enabledTiers.has(resolvedTier)) {
      return NextResponse.json(
        { error: `tier ${resolvedTier} is not enabled (REMIX_ENABLED_TIERS)` },
        { status: 403 },
      )
    }

    // t2 (reuse-clean-segments) requires a caller-supplied, validated segment
    // plan with at least one 'reuse' segment — otherwise there's nothing to reuse.
    let segmentPlan: ReturnType<typeof parseSegmentPlan> = null
    if (rawSegmentPlan !== undefined) {
      segmentPlan = parseSegmentPlan(rawSegmentPlan)
      if (segmentPlan === null) {
        return NextResponse.json({ error: 'segmentPlan is invalid — expected [{start,end,action,description?,reason?}]' }, { status: 400 })
      }
    }
    if (resolvedTier === 't2') {
      if (!segmentPlan || !segmentPlan.some((s) => s.action === 'reuse')) {
        return NextResponse.json(
          { error: 'tier t2 requires a segmentPlan with at least one "reuse" segment' },
          { status: 400 },
        )
      }
    }

    const cc = await prisma.competitorCreative.findFirst({
      where: { id: competitorCreativeId, orgId: org.id },
    })
    if (!cc) {
      return NextResponse.json({ error: 'Competitor creative not found' }, { status: 404 })
    }

    // t1 (generate-with-reference) / t2 (reuse-clean-segments) both need the
    // competitor's video already stored by the Tier-2 "Save video" flow — a
    // human-picked, legal-cleared Asset. We only read it here.
    if (resolvedTier === 't1' || resolvedTier === 't2') {
      const storedAsset = cc.assetId ? await prisma.asset.findFirst({ where: { id: cc.assetId, orgId: org.id } }) : null
      if (!storedAsset || !storedAsset.fileUrl) {
        return NextResponse.json(
          { error: 'competitor video not stored — use the Tier-2 "Save video" flow first' },
          { status: 400 },
        )
      }
    }
    // A segment plan indexes into the source video, so we need to know the
    // source's duration to validate it. Previously an unknown duration was a
    // silent skip of the maxEnd check below — a caller could submit a
    // segmentPlan reaching well past the actual video and it would sail
    // through, only to fail (or silently truncate) at the worker. Reject
    // instead: re-ingest the row with duration before accepting a segmentPlan.
    if (rawSegmentPlan !== undefined && !(typeof cc.duration === 'number' && cc.duration > 0)) {
      return NextResponse.json(
        {
          error:
            'source video duration unknown — cannot validate segmentPlan against it; re-ingest the competitor creative with duration first',
        },
        { status: 400 },
      )
    }
    if (segmentPlan && typeof cc.duration === 'number' && cc.duration > 0) {
      const maxEnd = segmentPlan[segmentPlan.length - 1].end
      if (maxEnd > cc.duration + 1) {
        return NextResponse.json(
          { error: `segmentPlan ends at ${maxEnd}s but the source video is ${cc.duration}s` },
          { status: 400 },
        )
      }
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
    const dims = workerCanvasDims(brief.ratio)

    // Review-gated ad (the thing a human approves before any push) + its RemixJob
    // created atomically — a crash between the two writes must never leave an
    // orphaned Creative with no job to fill it in, or vice versa. No render call
    // here — status stays 'generating' until the worker reports back via /report.
    const { creative, job } = await prisma.$transaction(async (tx) => {
      const creative = await tx.creative.create({
        data: {
          orgId: org.id,
          userId: user.id,
          name: `${productBrief.product} remix — ${brief.sourceRef}`.slice(0, 80),
          type: 'video',
          source: 'remix',
          prompt: brief.seedance2Prompt,
          sourceRef: cc.externalId,
          tags: JSON.stringify({
            tier: resolvedTier,
            engine: 'worker',
            borrowed: brief.borrowed,
            changed: brief.changed,
            compliance: brief.compliance,
            // Hard IP-provenance markers the review UI badges on — see
            // src/app/(dashboard)/creatives/{page,client}.tsx.
            ...(resolvedTier === 't1' ? { competitorReferenced: true } : {}),
            ...(resolvedTier === 't2' ? { containsCompetitorFootage: true } : {}),
          }),
          status: 'generating',
          reviewStatus: 'pending',
          width: dims.width,
          height: dims.height,
          // t2 output length is the sum of kept (reuse/remake) segments, not the
          // brief's whole-video estimate — dropped segments are cut from the timeline.
          duration:
            resolvedTier === 't2' && segmentPlan
              ? Math.round(segmentPlan.filter((s) => s.action !== 'drop').reduce((acc, s) => acc + (s.end - s.start), 0))
              : brief.durationSec,
        },
      })

      const job = await tx.remixJob.create({
        data: {
          orgId: org.id,
          userId: user.id,
          competitorCreativeId: cc.id,
          creativeId: creative.id,
          tier: resolvedTier,
          status: 'pending',
          brief: asJson(brief),
          segmentPlan: segmentPlan ? asJson(segmentPlan) : undefined,
        },
      })

      return { creative, job }
    })

    await logAudit({
      orgId: org.id,
      userId: user.id,
      action: 'remix.job_create',
      targetType: 'RemixJob',
      targetId: job.id,
      metadata: { jobId: job.id, tier: resolvedTier, competitorCreativeId: cc.id },
      req,
    })

    return NextResponse.json({ job, creative, brief })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Remix job creation failed'
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

  const id = req.nextUrl.searchParams.get('id')

  if (id) {
    try {
      const job = await prisma.remixJob.findFirst({ where: { id, orgId: org.id } })
      if (!job) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      let creativeSummary: { id: string; status: string; fileUrl: string | null; reviewNotes: string | null } | null = null
      if (job.creativeId) {
        const creative = await prisma.creative.findFirst({
          where: { id: job.creativeId, orgId: org.id },
          select: { id: true, status: true, fileUrl: true, reviewNotes: true },
        })
        if (creative) creativeSummary = creative
      }
      return NextResponse.json({ job: { ...job, creative: creativeSummary } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load remix job'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  try {
    const jobs = await prisma.remixJob.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })
    return NextResponse.json({ jobs })
  } catch {
    return NextResponse.json({ error: 'Failed to load remix jobs' }, { status: 500 })
  }
}
