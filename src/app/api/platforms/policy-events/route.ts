import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { recordAdPolicyStatus } from '@/lib/platforms/policy-violations'

/**
 * POST /api/platforms/policy-events
 *
 * Inbound webhook from a platform reporting an Ad's policy status change.
 *
 * Auth (in priority order):
 *   1. `X-Adex-Inbound-Signature: sha256=<hex>` HMAC over the raw body using
 *      `INBOUND_WEBHOOK_SECRET` env var. This is the production path — every
 *      bridge that posts here proves it knows the secret without sending it
 *      in plaintext, and the signature also tamper-evidences the body.
 *   2. Fallback: `X-Cron-Secret` shared secret (same value as cron). Kept
 *      for local-dev convenience.
 *
 * Body: { orgId, platformAdId, status: 'approved'|'pending_review'|'rejected', reason? }
 */
function verifySignature(req: NextRequest, body: string): boolean {
  const provided = req.headers.get('x-adex-inbound-signature')
  const secret = process.env.INBOUND_WEBHOOK_SECRET
  if (!provided || !secret) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
  // Constant-time compare to avoid timing leaks
  if (provided.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

function verifyCronFallback(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided =
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer /i, '')
  return provided === secret
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifySignature(req, raw) && !verifyCronFallback(req)) {
    return NextResponse.json(
      {
        error:
          'Unauthorized — provide X-Adex-Inbound-Signature (HMAC over raw body using INBOUND_WEBHOOK_SECRET) or X-Cron-Secret',
      },
      { status: 401 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  // Audit Critical #6: replay protection. Body MUST include `timestamp`
  // (unix seconds) within ±5 minutes of now. Closes the gap where
  // X-Cron-Secret fallback had no replay defense.
  const ts = Number(body.timestamp)
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return NextResponse.json(
      { error: 'body.timestamp (unix seconds) required, must be within 5 minutes of server clock' },
      { status: 400 }
    )
  }

  const orgId = String(body.orgId || '')
  const platformAdId = String(body.platformAdId || '')
  const status = body.status
  const reason = typeof body.reason === 'string' ? body.reason : undefined
  if (
    !orgId ||
    !platformAdId ||
    (status !== 'approved' && status !== 'pending_review' && status !== 'rejected')
  ) {
    return NextResponse.json(
      { error: 'orgId, platformAdId, status (approved|pending_review|rejected) required' },
      { status: 400 }
    )
  }
  const result = await recordAdPolicyStatus({ orgId, platformAdId, status, reason })
  return NextResponse.json({ ok: true, ...result })
}
