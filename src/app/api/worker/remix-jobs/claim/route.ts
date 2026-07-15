/**
 * POST /api/worker/remix-jobs/claim — atomic RemixJob pickup for the worker engine.
 *
 * Body: `{}` or `{ jobId }`. A job is claimable when it's `status: 'pending'`,
 * OR when it's in an in-flight status (`claimed|running|assembling|qc`) whose
 * `updatedAt` is older than the lease window (`REMIX_JOB_LEASE_MINUTES`,
 * default 30) — a worker that died mid-job leaves its job claimable again
 * instead of stuck forever. With `jobId`, claims that exact job iff it
 * currently satisfies the claimable condition. Without it, claims the oldest
 * pending job, falling back to the oldest stale in-flight job when the
 * pending queue is empty. Atomicity comes from a single
 * `updateMany({ where: { id, OR: [...] }, ... })` — only the caller whose
 * updateMany reports `count === 1` actually won the race; everyone else (and
 * an empty queue) gets `{ job: null }`, never a 409 — the worker is expected
 * to poll.
 *
 * Ref: src/lib/growth/remix-job.ts
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { readWorkerAuthHeaders, verifyWorkerHmac, workerUnauthorized } from '@/lib/growth/remix-job'

interface ClaimBody {
  jobId?: string
}

const IN_FLIGHT_STATUSES = ['claimed', 'running', 'assembling', 'qc']
const LEASE_MINUTES = Number(process.env.REMIX_JOB_LEASE_MINUTES || 30)

function claimableWhere(cutoff: Date): Prisma.RemixJobWhereInput['OR'] {
  return [
    { status: 'pending' },
    { status: { in: IN_FLIGHT_STATUSES }, updatedAt: { lt: cutoff } },
  ]
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

  const cutoff = new Date(Date.now() - LEASE_MINUTES * 60_000)

  let targetId: string | null = body.jobId ?? null
  if (!targetId) {
    const oldestPending = await prisma.remixJob.findFirst({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (oldestPending) {
      targetId = oldestPending.id
    } else {
      const oldestStale = await prisma.remixJob.findFirst({
        where: { status: { in: IN_FLIGHT_STATUSES }, updatedAt: { lt: cutoff } },
        orderBy: { updatedAt: 'asc' },
        select: { id: true },
      })
      targetId = oldestStale?.id ?? null
    }
  }

  let claimedId: string | null = null
  if (targetId) {
    const result = await prisma.remixJob.updateMany({
      where: { id: targetId, OR: claimableWhere(cutoff) },
      data: { status: 'claimed' },
    })
    claimedId = result.count === 1 ? targetId : null
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
