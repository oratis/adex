import crypto from 'node:crypto'

/**
 * Verify a Slack interactivity request signature.
 *
 * Audit Critical #5: hardened against timestamp coercion bugs:
 *   - Number(undefined) === NaN, and `NaN > 300` is false. Without an
 *     explicit isFinite check the age window silently bypasses.
 *   - timingSafeEqual throws if buffer lengths differ → wrap in try/catch.
 *
 * Inputs are passed in (rather than read from a NextRequest here) so this
 * function is straightforward to unit test.
 */
export function verifySlackSignature(opts: {
  secret: string | undefined
  timestamp: string | null | undefined
  signature: string | null | undefined
  rawBody: string
  /** Override "now" (epoch seconds) — only used in tests. */
  now?: number
  /** Max age in seconds. Default 5 minutes. */
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

  const base = `v0:${opts.timestamp}:${opts.rawBody}`
  const expected = `v0=${crypto.createHmac('sha256', opts.secret).update(base).digest('hex')}`
  if (opts.signature.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(opts.signature), Buffer.from(expected))
  } catch {
    return false
  }
}
