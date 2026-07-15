/**
 * Shared helpers for the worker-facing RemixJob API (src/app/api/worker/remix-jobs/**).
 *
 * The worker (a separate Cloud Run Job repo) claims jobs, generates each storyboard
 * beat, assembles the final clip, QCs it, and reports progress/results back here —
 * all authenticated with an HMAC shared secret (WORKER_WEBHOOK_SECRET), not the
 * session cookie used by the control-plane routes under /api/creatives/remix-jobs.
 *
 * Mirrors the HMAC contract in src/lib/growth/ingest-auth.ts:
 *   x-adex-timestamp  — epoch seconds
 *   x-adex-signature  — "sha256=" + HMAC_SHA256(secret, `${timestamp}:${rawBody}`)
 *
 * Ref: src/app/api/ingest/competitor/route.ts (sibling HMAC-ingest pattern)
 */
import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyHmac } from '@/lib/growth/ingest-auth'
import type { RemixJob } from '@/generated/prisma/client'

/** Headers the worker sends on every request to /api/worker/remix-jobs/**. */
export interface WorkerAuthHeaders {
  timestamp: string | null
  signature: string | null
}

/** Pull the shared HMAC headers off a worker request. */
export function readWorkerAuthHeaders(req: NextRequest): WorkerAuthHeaders {
  return {
    timestamp: req.headers.get('x-adex-timestamp'),
    signature: req.headers.get('x-adex-signature'),
  }
}

/**
 * Verify a worker request against WORKER_WEBHOOK_SECRET (no fallback default —
 * an unset secret means every request is rejected, never silently trusted).
 */
export function verifyWorkerHmac(headers: WorkerAuthHeaders, rawBody: string): boolean {
  return verifyHmac({
    secret: process.env.WORKER_WEBHOOK_SECRET,
    timestamp: headers.timestamp,
    signature: headers.signature,
    rawBody,
  })
}

/** Standard 401 body for a missing/invalid worker signature. */
export function workerUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

/** Hex-encoded SHA-256 of a buffer — used for the upload endpoint's content-hash gate. */
export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/** Look up a RemixJob by id, org-independent (worker endpoints operate purely on jobId). */
export async function findRemixJobById(jobId: string): Promise<RemixJob | null> {
  return prisma.remixJob.findUnique({ where: { id: jobId } })
}

/** Standard 404 body for an unknown jobId. */
export function jobNotFound(): NextResponse {
  return NextResponse.json({ error: 'not found' }, { status: 404 })
}
