import crypto from 'node:crypto'

/**
 * Auth for the growth ingest surface (docs/growth/00-cuddler-first-redesign.md
 * §5.3). Two mechanisms, each a pure function taking primitives so they unit
 * test without a NextRequest — the direct answer to the HakkoAI payment-callback
 * "no auth, no idempotency" P0.
 *
 *   verifyBearer  — constant-time secret compare. RevenueCat webhooks send a
 *                   static Authorization header you configure; this checks it.
 *   verifyHmac    — HMAC-SHA256 over `timestamp:body` with replay window, for
 *                   our own tagged event pushes (mirrors slack-signature.ts).
 */

/** Constant-time compare of a provided bearer/secret against the expected one. */
export function verifyBearer(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** Strip a leading "Bearer " (case-insensitive) from an Authorization header. */
export function readBearer(header: string | null | undefined): string | null {
  if (!header) return null
  return header.replace(/^Bearer\s+/i, '').trim() || null
}

/**
 * Verify an HMAC-signed ingest request.
 * Signature = "sha256=" + HMAC_SHA256(secret, `${timestamp}:${rawBody}`).
 * Rejects stale timestamps (default 5-min window) to blunt replay.
 */
export function verifyHmac(opts: {
  secret: string | undefined
  timestamp: string | null | undefined
  signature: string | null | undefined
  rawBody: string
  /** Override "now" (epoch seconds) — tests only. */
  now?: number
  maxAgeSeconds?: number
}): boolean {
  if (!opts.secret) return false
  if (!opts.timestamp || !opts.signature) return false

  const tsNum = Number(opts.timestamp)
  if (!Number.isFinite(tsNum)) return false

  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const maxAge = opts.maxAgeSeconds ?? 300
  const age = Math.abs(now - tsNum)
  if (!Number.isFinite(age) || age > maxAge) return false

  const base = `${opts.timestamp}:${opts.rawBody}`
  const expected = `sha256=${crypto.createHmac('sha256', opts.secret).update(base).digest('hex')}`
  if (opts.signature.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(opts.signature), Buffer.from(expected))
  } catch {
    return false
  }
}
