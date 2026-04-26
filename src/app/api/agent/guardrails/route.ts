import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

const VALID_RULES = [
  'budget_max_daily',
  'budget_max_total_daily',
  'budget_change_pct',
  'status_change',
  'high_risk_requires_approval',
  'agent_active_hours',
  'llm_budget_cap',
  'managed_only',
  'cooldown',
  'pause_only_with_conversions',
  'max_per_day',
  'requires_approval_above_spend',
] as const

const VALID_SCOPES = ['global', 'platform', 'campaign'] as const

export async function GET() {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const rows = await prisma.guardrail.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(rows)
}

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

  const body = await req.json()
  if (!(VALID_RULES as readonly string[]).includes(body.rule)) {
    return NextResponse.json({ error: 'Invalid rule', valid: VALID_RULES }, { status: 400 })
  }
  if (!(VALID_SCOPES as readonly string[]).includes(body.scope)) {
    return NextResponse.json({ error: 'Invalid scope', valid: VALID_SCOPES }, { status: 400 })
  }
  if (body.scope !== 'global' && !body.scopeId) {
    return NextResponse.json({ error: 'scopeId required when scope != global' }, { status: 400 })
  }
  let configJson: string
  try {
    configJson = JSON.stringify(body.config ?? {})
  } catch {
    return NextResponse.json({ error: 'config must be JSON-serializable' }, { status: 400 })
  }

  const row = await prisma.guardrail.create({
    data: {
      orgId: org.id,
      scope: body.scope,
      scopeId: body.scope === 'global' ? null : body.scopeId,
      rule: body.rule,
      config: configJson,
      isActive: body.isActive ?? true,
      createdBy: user.id,
    },
  })
  await logAudit({
    orgId: org.id,
    userId: user.id,
    action: 'advisor.apply',
    targetType: 'guardrail',
    targetId: row.id,
    metadata: { rule: row.rule, scope: row.scope },
    req,
  })
  return NextResponse.json(row)
}
