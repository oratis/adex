import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { getAdapter, isAdaptablePlatform } from '@/lib/platforms/registry'
import { captureCampaignSnapshots, detectDrift } from '@/lib/sync/snapshot'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * POST /api/agent/snapshot
 *
 * Manually capture campaign snapshots + run drift detection for the active
 * org. Bypasses cron (P12 work item 7). Per-org 1-min dedupe via in-memory
 * map; multi-instance deploys can swap in Memorystore later.
 */
const lastRunByOrg = new Map<string, number>()
const DEDUPE_MS = 60_000

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
  void user
  // Distributed rate limit (will share across instances when rate-limit.ts
  // moves to Redis). Hourly cap covers brute-force; the in-memory dedupe
  // below covers same-second double-clicks.
  const rl = checkRateLimit(req, {
    key: 'agent-snapshot',
    limit: 12,
    windowMs: 60 * 60_000,
    identity: org.id,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  const last = lastRunByOrg.get(org.id) || 0
  if (Date.now() - last < DEDUPE_MS) {
    return NextResponse.json(
      {
        error: 'Recent snapshot already in flight — wait a minute before re-triggering',
        retryAfterSeconds: Math.ceil((DEDUPE_MS - (Date.now() - last)) / 1000),
      },
      { status: 429 }
    )
  }
  lastRunByOrg.set(org.id, Date.now())

  const auths = await prisma.platformAuth.findMany({
    where: { orgId: org.id, isActive: true },
  })
  let snapshots = 0
  let orphans = 0
  let drifted = 0
  let approvalsCreated = 0
  const errors: string[] = []
  for (const auth of auths) {
    if (!isAdaptablePlatform(auth.platform)) continue
    try {
      const adapter = getAdapter(auth.platform, auth)
      const snap = await captureCampaignSnapshots({ adapter, orgId: org.id })
      snapshots += snap.snapshotsTaken
      orphans += snap.orphans
      const drift = await detectDrift({ orgId: org.id, platform: auth.platform })
      drifted += drift.drifted
      approvalsCreated += drift.approvalsCreated
    } catch (err) {
      errors.push(`${auth.platform}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return NextResponse.json({
    ok: true,
    snapshots,
    orphans,
    drifted,
    approvalsCreated,
    errors,
  })
}
