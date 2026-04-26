import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { fireWebhook } from '@/lib/webhooks'
import { canTransitionMode, transitionFields, type AgentMode } from '@/lib/agent/onboarding'

const VALID_MODES = ['shadow', 'approval_only', 'autonomous'] as const

export async function GET() {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const cfg =
    (await prisma.agentConfig.findUnique({ where: { orgId: org.id } })) ||
    (await prisma.agentConfig.create({
      data: { orgId: org.id, enabled: false, mode: 'shadow' },
    }))
  return NextResponse.json(cfg)
}

export async function PUT(req: NextRequest) {
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

  const existing = await prisma.agentConfig.findUnique({ where: { orgId: org.id } })

  const data: Record<string, unknown> = { updatedBy: user.id }
  if (typeof body.enabled === 'boolean') {
    data.enabled = body.enabled
    // First time enabling counts as starting shadow.
    if (body.enabled && !existing?.shadowStartedAt && !existing?.approvalOnlyStartedAt && !existing?.autonomousStartedAt) {
      data.shadowStartedAt = new Date()
    }
  }
  if (typeof body.mode === 'string' && (VALID_MODES as readonly string[]).includes(body.mode)) {
    const target = body.mode as AgentMode
    const check = canTransitionMode(existing, target, { allowDowngrade: true })
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason }, { status: 400 })
    }
    Object.assign(data, transitionFields(target))
  }
  if (typeof body.killSwitch === 'boolean') {
    data.killSwitch = body.killSwitch
    data.killSwitchAt = body.killSwitch ? new Date() : null
    if (body.killSwitch && typeof body.killSwitchReason === 'string')
      data.killSwitchReason = body.killSwitchReason
    if (!body.killSwitch) data.killSwitchReason = null
  }
  if (typeof body.monthlyLlmBudgetUsd === 'number')
    data.monthlyLlmBudgetUsd = body.monthlyLlmBudgetUsd

  const cfg = await prisma.agentConfig.upsert({
    where: { orgId: org.id },
    update: data,
    create: { orgId: org.id, enabled: false, mode: 'shadow', ...data },
  })
  await logAudit({
    orgId: org.id,
    userId: user.id,
    action: 'advisor.apply',
    targetType: 'agent_config',
    metadata: { changed: Object.keys(data) },
    req,
  })
  if (typeof body.killSwitch === 'boolean' && body.killSwitch) {
    fireWebhook({
      orgId: org.id,
      event: 'agent.killswitch.activated',
      data: { reason: cfg.killSwitchReason, by: user.id },
    }).catch(() => {})
  }
  return NextResponse.json(cfg)
}
