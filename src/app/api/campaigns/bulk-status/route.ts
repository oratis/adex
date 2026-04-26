import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { applyCampaignStatusChange } from '@/lib/platforms/apply-status'
import { PlatformError, type DesiredStatus } from '@/lib/platforms/adapter'

/**
 * POST /api/campaigns/bulk-status
 *  body: { ids: string[]; status: 'active'|'paused'|'archived' }
 *
 * Capped at 50 campaigns per request to bound platform API load. Continues
 * past per-campaign failures and returns a per-id outcome.
 */
const MAX = 50
const VALID_STATUS = new Set<DesiredStatus>(['active', 'paused', 'archived'])

export async function POST(req: NextRequest) {
  let user, org, role
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
    role = ctx.role
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Owner/admin only' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const status = body.status
  const ids: unknown = body.ids
  if (!VALID_STATUS.has(status)) {
    return NextResponse.json(
      { error: 'status must be active|paused|archived' },
      { status: 400 }
    )
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids: non-empty array required' }, { status: 400 })
  }
  if (ids.length > MAX) {
    return NextResponse.json({ error: `at most ${MAX} ids per call` }, { status: 400 })
  }
  const stringIds = ids.filter((x): x is string => typeof x === 'string')

  const results: Array<{ id: string; ok: boolean; error?: string; code?: string }> = []
  for (const id of stringIds) {
    try {
      await applyCampaignStatusChange({ orgId: org.id, campaignId: id, status })
      results.push({ id, ok: true })
    } catch (err) {
      const code = err instanceof PlatformError ? err.code : 'unknown'
      const msg = err instanceof Error ? err.message : 'failed'
      results.push({ id, ok: false, error: msg, code })
    }
  }

  await logAudit({
    orgId: org.id,
    userId: user.id,
    action: status === 'paused' ? 'campaign.pause' : 'campaign.resume',
    targetType: 'campaign_bulk',
    metadata: { status, total: stringIds.length, ok: results.filter((r) => r.ok).length },
    req,
  })
  return NextResponse.json({ results })
}
