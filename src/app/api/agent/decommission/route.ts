import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/agent/decommission
 *  body: { confirm: 'DISABLE_AGENT' }
 *
 * Cleanly turn off the agent for this org WITHOUT losing data:
 *   - flip enabled=false, mode=shadow
 *   - reject all pending approvals (with reason "decommissioned")
 *   - leave Decision / Outcome / PromptRun / Guardrail / etc. for audit
 *
 * Owner-only — has the same impact as Kill Switch but is meant for
 * permanent retreat, not emergency.
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
    return NextResponse.json({ error: 'Owner only — decommissioning is sensitive' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  if (body.confirm !== 'DISABLE_AGENT') {
    return NextResponse.json(
      { error: 'Pass { confirm: "DISABLE_AGENT" } to acknowledge.' },
      { status: 400 }
    )
  }

  // 1. Reject all pending approvals
  const pending = await prisma.pendingApproval.findMany({
    where: { orgId: org.id, decision: { status: 'pending' } },
  })
  if (pending.length > 0) {
    await prisma.$transaction([
      prisma.decision.updateMany({
        where: { id: { in: pending.map((p) => p.decisionId) } },
        data: { status: 'rejected', rejectedReason: 'decommissioned' },
      }),
      prisma.pendingApproval.deleteMany({
        where: { id: { in: pending.map((p) => p.id) } },
      }),
    ])
  }

  // 2. Flip config to safe state
  const cfg = await prisma.agentConfig.upsert({
    where: { orgId: org.id },
    update: {
      enabled: false,
      mode: 'shadow',
      killSwitch: false,
      killSwitchReason: null,
      autonomousAllowed: false,
      autonomousAllowedAt: null,
      updatedBy: user.id,
    },
    create: {
      orgId: org.id,
      enabled: false,
      mode: 'shadow',
      updatedBy: user.id,
    },
  })

  // 3. Audit
  await logAudit({
    orgId: org.id,
    userId: user.id,
    action: 'advisor.apply',
    targetType: 'agent_config',
    metadata: { decommissioned: true, pendingRejected: pending.length },
    req,
  })

  // Counts for summary email / receipt
  const [decisions, outcomes, promptRuns] = await Promise.all([
    prisma.decision.count({ where: { orgId: org.id } }),
    prisma.decisionOutcome.count({ where: { decision: { orgId: org.id } } }),
    // PromptRun has decisionId (not a relation in the schema), so we must
    // filter by the decision's IDs explicitly.
    prisma.promptRun.count({
      where: {
        decisionId: {
          in: (await prisma.decision.findMany({
            where: { orgId: org.id },
            select: { id: true },
          })).map((d) => d.id),
        },
      },
    }),
  ])

  return NextResponse.json({
    ok: true,
    pendingRejected: pending.length,
    config: cfg,
    archive: {
      decisionCount: decisions,
      outcomeCount: outcomes,
      promptRunCount: promptRuns,
      note: 'Historical records retained for audit. Re-enable any time via /agent-onboarding.',
    },
  })
}
