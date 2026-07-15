/**
 * POST /api/worker/remix-jobs/report — worker progress/result callback.
 *
 * Partial update: only fields present in the body are written to RemixJob.
 * status:'succeeded' requires `outputUrl` (400 otherwise) and promotes the
 * linked Creative to `{ status: 'ready', fileUrl: outputUrl }`. status:'failed'
 * demotes the linked Creative to `{ status: 'failed' }` and records `error`.
 *
 * Ref: src/lib/growth/remix-job.ts · src/app/api/creatives/remix/route.ts (GET,
 * which does the equivalent Creative promotion for the Seedance2-direct path)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { readWorkerAuthHeaders, verifyWorkerHmac, workerUnauthorized, jobNotFound } from '@/lib/growth/remix-job'

type ReportStatus = 'running' | 'assembling' | 'qc' | 'succeeded' | 'failed'
const VALID_STATUSES: ReportStatus[] = ['running', 'assembling', 'qc', 'succeeded', 'failed']

interface ReportBody {
  jobId?: string
  status?: ReportStatus
  beats?: unknown
  qcReport?: unknown
  costTokens?: number
  outputUrl?: string
  error?: string
}

function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue
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

  const existing = await prisma.remixJob.findUnique({ where: { id: body.jobId } })
  if (!existing) return jobNotFound()

  const data: Prisma.RemixJobUpdateInput = {}
  if (body.status !== undefined) data.status = body.status
  if (body.beats !== undefined) data.beats = asJson(body.beats)
  if (body.qcReport !== undefined) data.qcReport = asJson(body.qcReport)
  if (body.costTokens !== undefined) data.costTokens = body.costTokens
  if (body.outputUrl !== undefined) data.outputUrl = body.outputUrl
  if (body.error !== undefined) data.error = body.error

  const job = await prisma.remixJob.update({ where: { id: body.jobId }, data })

  if (job.creativeId) {
    if (body.status === 'succeeded' && body.outputUrl) {
      await prisma.creative.update({
        where: { id: job.creativeId },
        data: { status: 'ready', fileUrl: body.outputUrl },
      })
    } else if (body.status === 'failed') {
      await prisma.creative.update({
        where: { id: job.creativeId },
        data: { status: 'failed' },
      })
    }
  }

  return NextResponse.json({ ok: true, job })
}
