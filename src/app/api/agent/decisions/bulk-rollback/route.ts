import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getTool } from '@/lib/agent/tools'
import { executeApprovedDecision } from '@/lib/agent/act'

/**
 * POST /api/agent/decisions/bulk-rollback
 *  body: { ids: string[] }
 *
 * Rolls back each decision (per-decision logic same as the single-decision
 * rollback endpoint). Returns per-id outcome. Capped at 25 to bound work.
 */
const MAX = 25

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
  const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 })
  if (ids.length > MAX) {
    return NextResponse.json({ error: `at most ${MAX} ids per call` }, { status: 400 })
  }

  const results: Array<{ id: string; ok: boolean; rollbackDecisionId?: string; status?: string; error?: string; skipped?: string[] }> = []

  for (const id of ids) {
    try {
      const original = await prisma.decision.findFirst({
        where: { id, orgId: org.id, status: { in: ['executed', 'failed'] } },
        include: { steps: { orderBy: { stepIndex: 'asc' } } },
      })
      if (!original) {
        results.push({ id, ok: false, error: 'not found or not rollbackable' })
        continue
      }
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
          skipped.push(`${step.toolName} (no inverse)`)
          continue
        }
        inverseSteps.push({ ...inv, sourceStepId: step.id })
      }
      if (inverseSteps.length === 0) {
        results.push({ id, ok: false, error: 'no reversible steps', skipped })
        continue
      }

      const rollback = await prisma.decision.create({
        data: {
          orgId: org.id,
          triggerType: 'manual',
          perceiveContext: JSON.stringify({ rollbackOf: original.id, skipped, batchOp: true }),
          rationale: `Bulk rollback of decision ${original.id}: ${original.rationale.slice(0, 200)}`,
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
      const exec = await executeApprovedDecision(org.id, rollback.id, 'autonomous')
      if (exec.status === 'executed') {
        await prisma.decision.update({ where: { id: original.id }, data: { status: 'rolled_back' } })
      }
      results.push({ id, ok: true, rollbackDecisionId: rollback.id, status: exec.status, skipped })
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : 'failed' })
    }
  }

  await logAudit({
    orgId: org.id,
    userId: user.id,
    action: 'advisor.apply',
    targetType: 'decision',
    metadata: { bulkRollback: true, total: ids.length, ok: results.filter((r) => r.ok).length },
    req,
  })
  return NextResponse.json({ results })
}
