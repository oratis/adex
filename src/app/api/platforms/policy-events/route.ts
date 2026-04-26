import { NextRequest, NextResponse } from 'next/server'
import { recordAdPolicyStatus } from '@/lib/platforms/policy-violations'

/**
 * POST /api/platforms/policy-events
 *
 * Inbound webhook from a platform reporting an Ad's policy status change.
 * Authenticated via X-Cron-Secret (the same shared secret used for cron) so
 * that platform-side bridges can post structured events without standing up
 * separate auth.
 *
 *   { orgId, platform, platformAdId, status: 'approved'|'pending_review'|'rejected', reason? }
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  const provided =
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer /i, '')
  if (provided !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
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
