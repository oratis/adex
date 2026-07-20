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
import { asJson, workerCanvasDims } from '@/lib/growth/remix-job'

// Cost guardrails (mirrors /api/creatives/remix): burst limit + per-org daily cap.
const REMIX_BURST_LIMIT = Number(process.env.REMIX_BURST_LIMIT || 20)
const REMIX_DAILY_CAP = Number(process.env.REMIX_DAILY_CAP || 50)

// Only t0_5 is open this phase — t0/t1/t2/mixed are reserved for a later rollout.
const SUPPORTED_TIERS = ['t0_5'] as const
type SupportedTier = (typeof SUPPORTED_TIERS)[number]

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
    const { competitorCreativeId, tier, product, positioning, audience, artDirection, cta, differentiation, forbidden } = body

    if (!competitorCreativeId) {
      return NextResponse.json({ error: 'competitorCreativeId is required' }, { status: 400 })
    }
    if (!product || !positioning) {
      return NextResponse.json({ error: 'product and positioning are required' }, { status: 400 })
    }
    const resolvedTier: SupportedTier = tier === undefined ? 't0_5' : tier
    if (!SUPPORTED_TIERS.includes(resolvedTier)) {
      return NextResponse.json(
        { error: `Unsupported tier "${tier}" — only "t0_5" is available this phase` },
        { status: 400 },
      )
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
          }),
          status: 'generating',
          reviewStatus: 'pending',
          width: dims.width,
          height: dims.height,
          duration: brief.durationSec,
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
