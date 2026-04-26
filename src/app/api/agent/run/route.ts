import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithOrg } from '@/lib/auth'
import { runAgentLoop } from '@/lib/agent/loop'

/**
 * POST /api/agent/run — manual trigger of the agent loop for the active org.
 * Useful for the Decisions UI ("Run now" button) and for QA. Subject to the
 * same AgentConfig/killSwitch checks as the cron path.
 */
export async function POST(_req: NextRequest) {
  let user, org
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  void user
  const result = await runAgentLoop({ orgId: org.id, triggerType: 'manual' })
  return NextResponse.json(result)
}
