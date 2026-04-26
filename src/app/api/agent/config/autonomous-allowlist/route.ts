import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/agent/config/autonomous-allowlist
 *  body: { allowed: boolean }
 *
 * Per docs/agent/09-roadmap.md §Phase 16 work item 6: autonomous mode is
 * gated by an explicit per-org allowlist. Owners can opt in (mostly for
 * single-tenant self-hosters); SaaS deploys should restrict this further by
 * limiting who can hit this endpoint via reverse-proxy ACL.
 */
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
  if (role !== 'owner') {
    return NextResponse.json({ error: 'Owner only — autonomous allowlist is sensitive' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  if (typeof body.allowed !== 'boolean') {
    return NextResponse.json({ error: 'allowed: boolean required' }, { status: 400 })
  }
  const cfg = await prisma.agentConfig.upsert({
    where: { orgId: org.id },
    update: {
      autonomousAllowed: body.allowed,
      autonomousAllowedAt: body.allowed ? new Date() : null,
      autonomousAllowedBy: body.allowed ? user.id : null,
    },
    create: {
      orgId: org.id,
      enabled: false,
      mode: 'shadow',
      autonomousAllowed: body.allowed,
      autonomousAllowedAt: body.allowed ? new Date() : null,
      autonomousAllowedBy: body.allowed ? user.id : null,
    },
  })
  await logAudit({
    orgId: org.id,
    userId: user.id,
    action: 'advisor.apply',
    targetType: 'agent_config',
    metadata: { autonomousAllowed: body.allowed },
    req,
  })
  return NextResponse.json(cfg)
}
