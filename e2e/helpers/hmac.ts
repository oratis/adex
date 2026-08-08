/**
 * Shared HMAC signing helper for e2e specs that hit the HMAC-gated worker/ingest
 * routes (src/lib/growth/ingest-auth.ts's contract):
 *   x-adex-timestamp — epoch seconds
 *   x-adex-signature — "sha256=" + HMAC_SHA256(secret, `${timestamp}:${payload}`)
 *
 * Ref: e2e/remix-jobs.spec.ts · e2e/competitor-ingest.spec.ts
 */
import crypto from 'node:crypto'

export function sign(secret: string, payload: string): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}:${payload}`).digest('hex')}`
  return { timestamp, signature }
}
