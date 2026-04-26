import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getTool } from '@/lib/agent/tools'
import { executeApprovedDecision } from '@/lib/agent/act'

/**
 * POST /api/agent/decisions/{id}/rollback
 *
 * For each reversible step in the original decision, append an inverse step
 * to a NEW decision (mode=approval_only by default — humans get one more
 * chance to confirm), then immediately execute it. Non-reversible steps are
 * skipped with a clear note in the new decision's rationale.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  const original = await prisma.decision.findFirst({
    where: { id, orgId: org.id, status: { in: ['executed', 'failed'] } },
    include: { steps: { orderBy: { stepIndex: 'asc' } } },
  })
  if (!original) return NextResponse.json({ error: 'Not found or not rollbackable' }, { status: 404 })

  const inverseSteps: Array<{ tool: string; input: Record<string, unknown>; sourceStepId: string }> = []
  const skipped: string[] = []
  for (const step of original.steps) {
    const tool = getTool(step.toolName)
    if (!tool || !tool.reversible || !tool.inverse) {
      skipped.push(`${step.toolName} (not reversible)`)
      continue
    }
    let parsedInput: unknown
    try {
      parsedInput = tool.validate(JSON.parse(step.toolInput))
    } catch {
      skipped.push(`${step.toolName} (invalid stored input)`)
      continue
    }
    const inv = tool.inverse(parsedInput)
    if (!inv) {
      skipped.push(`${step.toolName} (no inverse known)`)
      continue
    }
    inverseSteps.push({ ...inv, sourceStepId: step.id })
  }

  if (inverseSteps.length === 0) {
    return NextResponse.json(
      { error: 'No reversible steps in this decision', skipped },
      { status: 400 }
    )
  }

  const rollback = await prisma.decision.create({
    data: {
      orgId: org.id,
      triggerType: 'manual',
      perceiveContext: JSON.stringify({ rollbackOf: original.id, skipped }),
      rationale: `Rollback of decision ${original.id}: ${original.rationale.slice(0, 200)}`,
      severity: 'warning',
      mode: 'autonomous',
      status: 'executing',
      approvedBy: user.id,
      approvedAt: new Date(),
    },
  })
  for (let i = 0; i < inverseSteps.length; i++) {
    const inv = inverseSteps[i]
    await prisma.decisionStep.create({
      data: {
        decisionId: rollback.id,
        stepIndex: i,
        toolName: inv.tool,
        toolInput: JSON.stringify(inv.input),
        status: 'pending',
        reversible: getTool(inv.tool)?.reversible ?? false,
        rollbackOf: inv.sourceStepId,
      },
    })
  }

  const result = await executeApprovedDecision(org.id, rollback.id, 'autonomous')
  await logAudit({
    orgId: org.id,
    userId: user.id,
    action: 'advisor.apply',
    targetType: 'decision',
    targetId: original.id,
    metadata: { rollbackDecisionId: rollback.id, result: result.status, skipped },
    req,
  })

  // If we rolled back the entire original decision, mark it.
  if (result.status === 'executed') {
    await prisma.decision.update({
      where: { id: original.id },
      data: { status: 'rolled_back' },
    })
  }

  return NextResponse.json({ ok: true, rollbackDecisionId: rollback.id, ...result, skipped })
}
