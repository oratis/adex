/**
 * POST /api/worker/remix-jobs/upload?jobId=<id> — worker pushes the assembled clip.
 *
 * Body is raw `video/mp4` bytes (100MB cap, 413 over). Auth differs from the other
 * two worker endpoints: the signature covers the content hash, not the body itself
 * (a giant HMAC over the raw video would mean buffering it twice) —
 *   x-adex-content-sha256 — hex SHA-256 of the request body
 *   x-adex-signature      — "sha256=" + HMAC_SHA256(secret, `${timestamp}:${contentSha256}`)
 * The server recomputes the body's hash, rejects on mismatch, then verifies the
 * HMAC over that (server-computed, not client-claimed) hash.
 *
 * On success, uploads to GCS at `remix/${orgId}/${jobId}.mp4` and returns the URL —
 * it does NOT touch RemixJob/Creative state; the worker calls /report separately.
 *
 * Ref: src/lib/growth/remix-job.ts · src/lib/storage.ts (uploadToGCS)
 */
import { NextRequest, NextResponse } from 'next/server'
import { uploadToGCS } from '@/lib/storage'
import {
  findRemixJobById,
  jobNotFound,
  readWorkerAuthHeaders,
  sha256Hex,
  verifyWorkerHmac,
  workerUnauthorized,
} from '@/lib/growth/remix-job'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100MB

export async function POST(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const headers = readWorkerAuthHeaders(req)
  const contentSha256 = req.headers.get('x-adex-content-sha256')

  const arrayBuffer = await req.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'file too large' }, { status: 413 })
  }

  const actualSha256 = sha256Hex(buffer)
  if (!contentSha256 || contentSha256 !== actualSha256) {
    return workerUnauthorized()
  }
  if (!verifyWorkerHmac(headers, actualSha256)) {
    return workerUnauthorized()
  }

  const job = await findRemixJobById(jobId)
  if (!job) return jobNotFound()

  try {
    const fileUrl = await uploadToGCS(buffer, `remix/${job.orgId}/${jobId}.mp4`, 'video/mp4')
    return NextResponse.json({ fileUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GCS upload failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
