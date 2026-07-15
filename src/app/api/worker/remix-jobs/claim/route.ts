/**
 * POST /api/worker/remix-jobs/claim — atomic RemixJob pickup for the worker engine.
 *
 * Body: `{}` or `{ jobId }`. With `jobId`, claims that exact job iff it's still
 * 'pending'. Without it, claims the oldest 'pending' job. Atomicity comes from
 * `updateMany({ where: { status: 'pending' }, ... })` — only the caller whose
 * updateMany reports `count === 1` actually won the race; everyone else (and an
 * empty queue) gets `{ job: null }`, never a 409 — the worker is expected to poll.
 *
 * Ref: src/lib/growth/remix-job.ts
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readWorkerAuthHeaders, verifyWorkerHmac, workerUnauthorized } from '@/lib/growth/remix-job'

interface ClaimBody {
  jobId?: string
}

export async function POST(req: NextRequest) {
  const headers = readWorkerAuthHeaders(req)
  const rawBody = await req.text()
  if (!verifyWorkerHmac(headers, rawBody)) {
    return workerUnauthorized()
  }

  let body: ClaimBody = {}
  if (rawBody) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'invalid json' }, { status: 400 })
    }
  }

  let claimedId: string | null = null
  if (body.jobId) {
    const result = await prisma.remixJob.updateMany({
      where: { id: body.jobId, status: 'pending' },
      data: { status: 'claimed' },
    })
    claimedId = result.count === 1 ? body.jobId : null
  } else {
    const oldest = await prisma.remixJob.findFirst({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (oldest) {
      const result = await prisma.remixJob.updateMany({
        where: { id: oldest.id, status: 'pending' },
        data: { status: 'claimed' },
      })
      claimedId = result.count === 1 ? oldest.id : null
    }
  }

  if (!claimedId) {
    return NextResponse.json({ job: null })
  }

  const job = await prisma.remixJob.findUnique({ where: { id: claimedId } })
  if (!job) {
    return NextResponse.json({ job: null })
  }

  return NextResponse.json({
    job: {
      id: job.id,
      orgId: job.orgId,
      tier: job.tier,
      brief: job.brief,
      segmentPlan: job.segmentPlan,
      creativeId: job.creativeId,
    },
  })
}
