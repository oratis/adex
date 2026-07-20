/**
 * POST /api/worker/remix-jobs/upload?jobId=<id> — worker pushes the assembled clip.
 *
 * Body is raw `video/mp4` bytes (100MB cap, 413 over). Auth differs from the other
 * two worker endpoints: the signature covers the content hash, not the body itself
 * (a giant HMAC over the raw video would mean buffering it twice) —
 *   x-adex-claim-token    — the caller's current claim fencing token (required)
 *   x-adex-content-sha256 — hex SHA-256 of the request body
 *   x-adex-signature      — "sha256=" + HMAC_SHA256(secret, `${timestamp}:${jobId}:${claimToken}:${contentSha256}`)
 * The server recomputes the body's hash, rejects on mismatch, then verifies the
 * HMAC over that (server-computed, not client-claimed) hash bound to jobId +
 * claimToken. Binding the signature to the claim token means a preempted worker
 * can't replay a still-valid-looking signature after its lease was reclaimed —
 * its old token no longer matches job.claimToken (checked below → 409), and it
 * can't forge a signature for the new token without the shared secret.
 *
 * Fencing: after HMAC passes, the job must exist (404), its claimToken must match
 * the caller's (409 'stale claim' otherwise — the caller lost the lease), and its
 * status must be in-flight (409 'job is not in-flight' otherwise). Only then do we
 * upload, versioned by `attempt` so retried/preempted attempts never collide:
 * `remix/${orgId}/${jobId}/v${attempt}.mp4`.
 *
 * On success, uploads to GCS and returns the URL — it does NOT touch RemixJob/
 * Creative state; the worker calls /report separately.
 *
 * Ref: src/lib/growth/remix-job.ts · src/lib/storage.ts (uploadToGCS)
 */
import { NextRequest, NextResponse } from 'next/server'
import { uploadToGCS } from '@/lib/storage'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'
import {
  findRemixJobById,
  jobNotFound,
  readWorkerAuthHeaders,
  sha256Hex,
  verifyWorkerHmac,
  workerUnauthorized,
} from '@/lib/growth/remix-job'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100MB
const IN_FLIGHT_STATUSES = ['claimed', 'running', 'assembling', 'qc']

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, { key: 'worker-upload', limit: 120, windowMs: 60_000 })
  if (!rl.ok) return rateLimitResponse(rl)

  const jobId = req.nextUrl.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const headers = readWorkerAuthHeaders(req)
  const contentSha256 = req.headers.get('x-adex-content-sha256')
  const claimToken = req.headers.get('x-adex-claim-token')

  if (!headers.timestamp || !headers.signature || !contentSha256 || !claimToken) {
    return workerUnauthorized()
  }

  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'file too large' }, { status: 413 })
  }

  const arrayBuffer = await req.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'file too large' }, { status: 413 })
  }

  const actualSha256 = sha256Hex(buffer)
  if (!contentSha256 || contentSha256 !== actualSha256) {
    return workerUnauthorized()
  }
  if (!verifyWorkerHmac(headers, `${jobId}:${claimToken}:${actualSha256}`)) {
    return workerUnauthorized()
  }

  const job = await findRemixJobById(jobId)
  if (!job) return jobNotFound()
  if (job.claimToken !== claimToken) {
    return NextResponse.json({ error: 'stale claim', currentStatus: job.status }, { status: 409 })
  }
  if (!IN_FLIGHT_STATUSES.includes(job.status)) {
    return NextResponse.json({ error: 'job is not in-flight', currentStatus: job.status }, { status: 409 })
  }

  try {
    const fileUrl = await uploadToGCS(buffer, `remix/${job.orgId}/${jobId}/v${job.attempt}.mp4`, 'video/mp4')
    await logAudit({
      orgId: job.orgId,
      userId: job.userId,
      action: 'remix.job_upload',
      targetType: 'RemixJob',
      targetId: job.id,
      metadata: { attempt: job.attempt },
      req,
    })
    return NextResponse.json({ fileUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GCS upload failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
