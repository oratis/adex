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
import type { Prisma, RemixJob } from '@/generated/prisma/client'

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

/** Cast an arbitrary value to a Prisma JSON input — shared by every route that writes RemixJob JSON columns. */
export function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue
}

/** Tiers the tier-gating validator recognizes as structurally valid (400 if outside this set). */
export const KNOWN_TIERS = ['t0_5', 't1', 't2'] as const
export type KnownTier = (typeof KNOWN_TIERS)[number]

/**
 * Parse the REMIX_ENABLED_TIERS env gate into a set of enabled tier codes.
 * Defaults to `{'t0_5'}` when unset/empty — the shipped default stays
 * IP-policy-conservative until an operator explicitly opts in to t1/t2.
 * The baseline t0_5 tier is ALWAYS enabled: this env var only ever widens
 * the set (an operator setting "t1" must not silently break the default path).
 */
export function parseEnabledTiers(env?: string): Set<string> {
  const raw = env ?? process.env.REMIX_ENABLED_TIERS
  const tiers = new Set(['t0_5'])
  if (!raw || !raw.trim()) return tiers
  for (const t of raw.split(',')) {
    const trimmed = t.trim()
    if (trimmed) tiers.add(trimmed)
  }
  return tiers
}

/** One segment-routing instruction within a RemixJob.segmentPlan. */
export interface SegmentPlanEntry {
  start: number
  end: number
  action: 'reuse' | 'remake' | 'drop'
  description?: string
  reason?: string
}

const SEGMENT_ACTIONS = new Set(['reuse', 'remake', 'drop'])

/** Upper bound on segmentPlan entries — a plan is a shot list, not a firehose. */
export const SEGMENT_PLAN_MAX_ENTRIES = 64

/**
 * Validate + normalize a POST body's `segmentPlan` field. Returns `null` on
 * any structural violation (route layer turns that into a 400) — never
 * throws, since this runs on untrusted request input.
 * Beyond per-entry shape: entries must be timeline-ordered (ascending start)
 * and non-overlapping, starts non-negative, and the list capped at
 * SEGMENT_PLAN_MAX_ENTRIES — the plan is stored verbatim and echoed to the
 * worker, so unbounded/incoherent input must die here.
 */
export function parseSegmentPlan(raw: unknown): SegmentPlanEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > SEGMENT_PLAN_MAX_ENTRIES) return null

  const out: SegmentPlanEntry[] = []
  let prevEnd = -Infinity
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const { start, end, action, description, reason } = item as Record<string, unknown>
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
      return null
    }
    if (start < 0 || start >= end) return null
    if (start < prevEnd) return null // overlapping or out-of-order segments
    if (typeof action !== 'string' || !SEGMENT_ACTIONS.has(action)) return null
    if (description !== undefined && typeof description !== 'string') return null
    if (reason !== undefined && typeof reason !== 'string') return null

    const entry: SegmentPlanEntry = { start, end, action: action as SegmentPlanEntry['action'] }
    if (typeof description === 'string') entry.description = description
    if (typeof reason === 'string') entry.reason = reason
    out.push(entry)
    prevEnd = end
  }
  return out
}

/**
 * Canvas dimensions per storyboard ratio — this is the actual canvas the
 * worker renders to, so Creative.width/height must be derived from this (not
 * a route-local guess) to match the delivered clip.
 */
export function workerCanvasDims(ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4'): { width: number; height: number } {
  switch (ratio) {
    case '16:9': return { width: 1920, height: 1080 }
    case '1:1': return { width: 1080, height: 1080 }
    case '4:3': return { width: 1440, height: 1080 }
    case '3:4': return { width: 1080, height: 1440 }
    case '9:16':
    default: return { width: 1080, height: 1920 }
  }
}
