import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { executeApprovedDecision } from '@/lib/agent/act'
import type { AgentMode } from '@/lib/agent/types'

/**
 * POST /api/agent/approvals/bulk
 *  body: { ids: string[]; action: 'approve' | 'reject'; reason?: string }
 *
 * Bulk handler — capped at 50 ids per call to bound the work in a single
 * request. Continues on per-row errors and returns a per-id result.
 */
const MAX_BULK = 50

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
  const action = body.action
  const ids: unknown = body.ids
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve|reject' }, { status: 400 })
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids: non-empty array required' }, { status: 400 })
  }
  if (ids.length > MAX_BULK) {
    return NextResponse.json({ error: `at most ${MAX_BULK} ids per call` }, { status: 400 })
  }
  const stringIds = ids.filter((x): x is string => typeof x === 'string')

  const results: Array<{ id: string; status: string; error?: string }> = []
  for (const approvalId of stringIds) {
    try {
      const approval = await prisma.pendingApproval.findFirst({
        where: { id: approvalId, orgId: org.id },
        include: { decision: true },
      })
      if (!approval) {
        results.push({ id: approvalId, status: 'error', error: 'not found' })
        continue
      }
      if (approval.decision.status !== 'pending') {
        results.push({
          id: approvalId,
          status: 'error',
          error: `already ${approval.decision.status}`,
        })
        continue
      }
      if (action === 'reject') {
        await prisma.decision.update({
          where: { id: approval.decisionId },
          data: {
            status: 'rejected',
            rejectedReason: reason,
            approvedBy: user.id,
            approvedAt: new Date(),
          },
        })
        await prisma.pendingApproval.delete({ where: { id: approval.id } })
        results.push({ id: approvalId, status: 'rejected' })
        continue
      }
      await prisma.decision.update({
        where: { id: approval.decisionId },
        data: { approvedBy: user.id, approvedAt: new Date() },
      })
      await prisma.pendingApproval.delete({ where: { id: approval.id } })
      const exec = await executeApprovedDecision(
        org.id,
        approval.decisionId,
        approval.decision.mode as AgentMode
      )
      results.push({ id: approvalId, status: exec.status })
    } catch (err) {
      results.push({
        id: approvalId,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  await logAudit({
    orgId: org.id,
    userId: user.id,
    action: 'advisor.apply',
    targetType: 'approval_bulk',
    metadata: { action, total: stringIds.length, ok: results.filter((r) => r.status !== 'error').length },
    req,
  })
  return NextResponse.json({ results })
}
