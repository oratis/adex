/**
 * POST /api/worker/remix-jobs/report — worker progress/result callback.
 *
 * Partial update: only fields present in the body are written to RemixJob.
 * status:'succeeded' requires `outputUrl` (400 otherwise) and promotes the
 * linked Creative to `{ status: 'ready', fileUrl: outputUrl }`. status:'failed'
 * demotes the linked Creative to `{ status: 'failed' }` and records `error`.
 *
 * State machine: status transitions are only legal from a fixed set of prior
 * statuses (ALLOWED_PREV) and are enforced atomically via a single
 * `updateMany({ where: { id, status: { in: ... } } })` — if `count !== 1` the
 * transition was illegal (raced or out of order), so we re-read the current
 * status and return 409. succeeded/failed are terminal: no further status
 * report is ever a legal prior state for another transition. A report with no
 * `status` (pure progress: beats/qcReport/costTokens) is allowed as long as
 * the job hasn't already reached a terminal state.
 *
 * Ref: src/lib/growth/remix-job.ts · src/app/api/creatives/remix/route.ts (GET,
 * which does the equivalent Creative promotion for the Seedance2-direct path)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { gcsPublicPrefix } from '@/lib/storage'
import {
  asJson,
  readWorkerAuthHeaders,
  verifyWorkerHmac,
  workerUnauthorized,
  jobNotFound,
} from '@/lib/growth/remix-job'

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
  status?: ReportStatus
  beats?: unknown
  qcReport?: unknown
  costTokens?: number
  outputUrl?: string
  error?: string
}

export async function POST(req: NextRequest) {
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
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }
  if (body.status === 'succeeded' && !body.outputUrl) {
    return NextResponse.json({ error: 'outputUrl is required when status is succeeded' }, { status: 400 })
  }
  if (body.status === 'succeeded' && body.outputUrl) {
    const existingForCheck = await prisma.remixJob.findUnique({
      where: { id: body.jobId },
      select: { orgId: true, id: true },
    })
    if (!existingForCheck) return jobNotFound()
    const canonicalPrefix = gcsPublicPrefix()
    const canonicalSubstring = `remix/${existingForCheck.orgId}/${existingForCheck.id}`
    if (!body.outputUrl.startsWith(canonicalPrefix) || !body.outputUrl.includes(canonicalSubstring)) {
      return NextResponse.json(
        { error: 'outputUrl does not match the canonical upload path' },
        { status: 400 },
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
    const result = await prisma.remixJob.updateMany({
      where: { id: body.jobId, status: { in: ALLOWED_PREV[body.status] } },
      data,
    })
    updateCount = result.count
  } else {
    const result = await prisma.remixJob.updateMany({
      where: { id: body.jobId, status: { notIn: TERMINAL_STATUSES } },
      data,
    })
    updateCount = result.count
  }

  if (updateCount !== 1) {
    const current = await prisma.remixJob.findUnique({ where: { id: body.jobId }, select: { status: true } })
    if (!current) return jobNotFound()
    return NextResponse.json({ error: 'illegal transition', currentStatus: current.status }, { status: 409 })
  }

  const job = await prisma.remixJob.findUnique({ where: { id: body.jobId } })
  if (!job) return jobNotFound()

  if (job.creativeId) {
    if (body.status === 'succeeded' && body.outputUrl) {
      const qcReport = (body.qcReport ?? job.qcReport) as { pass?: boolean; hits?: unknown[] } | null | undefined
      const creativeData: Prisma.CreativeUpdateInput = { status: 'ready', fileUrl: body.outputUrl }
      if (qcReport && qcReport.pass === false) {
        const hitCount = Array.isArray(qcReport.hits) ? qcReport.hits.length : 0
        creativeData.reviewNotes = `brand QC FAILED (${hitCount} hits) — see RemixJob ${job.id}`
      }
      await prisma.creative.update({ where: { id: job.creativeId }, data: creativeData })
    } else if (body.status === 'failed') {
      await prisma.creative.update({
        where: { id: job.creativeId },
        data: { status: 'failed' },
      })
    }
  }

  return NextResponse.json({ ok: true, job })
}
