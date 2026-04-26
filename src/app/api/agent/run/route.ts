import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithOrg } from '@/lib/auth'
import { runAgentLoop } from '@/lib/agent/loop'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * POST /api/agent/run — manual trigger of the agent loop for the active org.
 *
 * Rate-limited to 6 calls / hour / org since each call hits the LLM and
 * costs real money. The cron path (/api/cron/agent) bypasses this — only
 * UI / human-driven invocations are throttled here.
 */
export async function POST(req: NextRequest) {
  let user, org
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  void user
  const rl = checkRateLimit(req, {
    key: 'agent-run',
    limit: 6,
    windowMs: 60 * 60_000,
    identity: org.id,
  })
  if (!rl.ok) return rateLimitResponse(rl)
  const result = await runAgentLoop({ orgId: org.id, triggerType: 'manual' })
  return NextResponse.json(result)
}
