/**
 * POST /api/worker/remix-jobs/report — worker progress/result callback.
 *
 * Partial update: only fields present in the body are written to RemixJob.
 * status:'succeeded' requires `outputUrl` (400 otherwise) and promotes the
 * linked Creative to `{ status: 'ready', fileUrl: outputUrl }`. status:'failed'
 * demotes the linked Creative to `{ status: 'failed' }` and records `error`.
 *
 * Claim fencing: `claimToken` is required in the body and both updateMany
 * calls include it in their `where` — the update is only atomic (and only
 * happens at all) for the current lease holder. When `count !== 1` we re-read
 * to disambiguate why: job gone (404), claimToken mismatch (409 'stale
 * claim' — someone else holds the lease now), or an illegal status
 * transition (409, unchanged from before).
 *
 * State machine: status transitions are only legal from a fixed set of prior
 * statuses (ALLOWED_PREV) and are enforced atomically via a single
 * `updateMany({ where: { id, claimToken, status: { in: ... } } })`.
 * succeeded/failed are terminal: no further status report is ever a legal
 * prior state for another transition. A report with no `status` (pure
 * progress: beats/qcReport/costTokens) is allowed as long as the job hasn't
 * already reached a terminal state.
 *
 * Transaction: the updateMany + re-read (on count!==1) + linked-Creative
 * update all run inside a single `prisma.$transaction` — if the Creative
 * write fails, the RemixJob status change rolls back with it, so a job can
 * never end up "succeeded" with its Creative still stuck at 'generating'.
 *
 * Ref: src/lib/growth/remix-job.ts · src/app/api/creatives/remix/route.ts (GET,
 * which does the equivalent Creative promotion for the Seedance2-direct path)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { deleteFromGCS, gcsPublicPrefix, GCS_UPLOAD_PREFIX } from '@/lib/storage'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'
import {
  asJson,
  readWorkerAuthHeaders,
  verifyWorkerHmac,
  workerUnauthorized,
  jobNotFound,
} from '@/lib/growth/remix-job'

/** Thrown inside the transaction to short-circuit with a specific HTTP response. */
class ReportRouteError extends Error {
  constructor(public response: NextResponse) {
    super('report route short-circuit')
  }
}

type ReportStatus = 'running' | 'assembling' | 'qc' | 'succeeded' | 'failed'
const VALID_STATUSES: ReportStatus[] = ['running', 'assembling', 'qc', 'succeeded', 'failed']

// Legal prior statuses for each target status. Anything not listed here (in
// particular 'succeeded' and 'failed' as a *prior* status) can never match,
// which is what makes both terminal.
const ALLOWED_PREV: Record<ReportStatus, string[]> = {
  running: ['claimed', 'running'],
  assembling: ['running', 'assembling'],
  qc: ['assembling', 'qc'],
  succeeded: ['running', 'assembling', 'qc'],
  failed: ['pending', 'claimed', 'running', 'assembling', 'qc'],
}

const TERMINAL_STATUSES = ['succeeded', 'failed']

interface ReportBody {
  jobId?: string
  claimToken?: string
  status?: ReportStatus
  beats?: unknown
  qcReport?: unknown
  costTokens?: number
  outputUrl?: string
  error?: string
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, { key: 'worker-report', limit: 300, windowMs: 60_000 })
  if (!rl.ok) return rateLimitResponse(rl)

  const headers = readWorkerAuthHeaders(req)
  const rawBody = await req.text()
  if (!verifyWorkerHmac(headers, rawBody)) {
    return workerUnauthorized()
  }

  let body: ReportBody
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!body.jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }
  if (!body.claimToken) {
    return NextResponse.json({ error: 'claimToken is required' }, { status: 400 })
  }
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }
  if (body.status === 'succeeded' && !body.outputUrl) {
    return NextResponse.json({ error: 'outputUrl is required when status is succeeded' }, { status: 400 })
  }

  const jobId = body.jobId
  const claimToken = body.claimToken

  try {
    const job = await prisma.$transaction(async (tx) => {
      if (body.status === 'succeeded' && body.outputUrl) {
        const existingForCheck = await tx.remixJob.findUnique({
          where: { id: jobId },
          select: { orgId: true, id: true, attempt: true },
        })
        if (!existingForCheck) throw new ReportRouteError(jobNotFound())
        const canonicalUrl =
          `${gcsPublicPrefix()}${GCS_UPLOAD_PREFIX}/remix/${existingForCheck.orgId}/${existingForCheck.id}/v${existingForCheck.attempt}.mp4`
        if (body.outputUrl !== canonicalUrl) {
          throw new ReportRouteError(
            NextResponse.json({ error: 'outputUrl does not match the canonical upload path' }, { status: 400 }),
          )
        }
      }

      const data: Prisma.RemixJobUpdateInput = {}
      if (body.status !== undefined) data.status = body.status
      if (body.beats !== undefined) data.beats = asJson(body.beats)
      if (body.qcReport !== undefined) data.qcReport = asJson(body.qcReport)
      if (body.costTokens !== undefined) data.costTokens = body.costTokens
      if (body.outputUrl !== undefined) data.outputUrl = body.outputUrl
      if (body.error !== undefined) data.error = body.error

      let updateCount: number
      if (body.status !== undefined) {
        const result = await tx.remixJob.updateMany({
          where: { id: jobId, claimToken, status: { in: ALLOWED_PREV[body.status] } },
          data,
        })
        updateCount = result.count
      } else {
        const result = await tx.remixJob.updateMany({
          where: { id: jobId, claimToken, status: { notIn: TERMINAL_STATUSES } },
          data,
        })
        updateCount = result.count
      }

      if (updateCount !== 1) {
        const current = await tx.remixJob.findUnique({ where: { id: jobId }, select: { status: true, claimToken: true } })
        if (!current) throw new ReportRouteError(jobNotFound())
        if (current.claimToken !== claimToken) {
          throw new ReportRouteError(
            NextResponse.json({ error: 'stale claim', currentStatus: current.status }, { status: 409 }),
          )
        }
        throw new ReportRouteError(
          NextResponse.json({ error: 'illegal transition', currentStatus: current.status }, { status: 409 }),
        )
      }

      const updated = await tx.remixJob.findUnique({ where: { id: jobId } })
      if (!updated) throw new ReportRouteError(jobNotFound())

      if (updated.creativeId) {
        if (body.status === 'succeeded' && body.outputUrl) {
          const qcReport = (body.qcReport ?? updated.qcReport) as { pass?: boolean; hits?: unknown[] } | null | undefined
          const creativeData: Prisma.CreativeUpdateInput = { status: 'ready', fileUrl: body.outputUrl }
          if (qcReport && qcReport.pass === false) {
            const hitCount = Array.isArray(qcReport.hits) ? qcReport.hits.length : 0
            creativeData.reviewNotes = `brand QC FAILED (${hitCount} hits) — see RemixJob ${updated.id}`
          }
          await tx.creative.update({ where: { id: updated.creativeId }, data: creativeData })
        } else if (body.status === 'failed') {
          await tx.creative.update({
            where: { id: updated.creativeId },
            data: { status: 'failed' },
          })
        }
      }

      return updated
    })

    if (body.status && TERMINAL_STATUSES.includes(body.status)) {
      await logAudit({
        orgId: job.orgId,
        userId: job.userId,
        action: 'remix.job_report',
        targetType: 'RemixJob',
        targetId: job.id,
        metadata: { status: body.status },
        req,
      })
    }

    // Best-effort orphan cleanup: only covers the blob at the job's *current*
    // attempt. If the worker uploaded successfully but crashed before calling
    // /report at all (no report ever lands), that blob has no report to
    // trigger this cleanup and may linger — a known partial-coverage gap, not
    // addressed by this route.
    if (body.status === 'failed') {
      const canonicalUrl = `${gcsPublicPrefix()}${GCS_UPLOAD_PREFIX}/remix/${job.orgId}/${job.id}/v${job.attempt}.mp4`
      void deleteFromGCS(canonicalUrl).catch(() => {})
    }

    return NextResponse.json({ ok: true, job })
  } catch (error) {
    if (error instanceof ReportRouteError) return error.response
    throw error
  }
}
