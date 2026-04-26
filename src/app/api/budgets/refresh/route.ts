import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithOrg } from '@/lib/auth'
import { refreshBudgetSpent } from '@/lib/budget/refresh'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * POST /api/budgets/refresh — recompute Budget.spent for the active org from
 * the latest Report rows. Useful after a manual sync, or on the budget page.
 */
export async function POST(req: NextRequest) {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const rl = checkRateLimit(req, {
    key: 'budget-refresh',
    limit: 30,
    windowMs: 60 * 60_000,
    identity: org.id,
  })
  if (!rl.ok) return rateLimitResponse(rl)
  const result = await refreshBudgetSpent({ orgId: org.id })
  return NextResponse.json({ ok: true, ...result })
}
