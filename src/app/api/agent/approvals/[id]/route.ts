import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { executeApprovedDecision } from '@/lib/agent/act'
import type { AgentMode } from '@/lib/agent/types'

/**
 * POST /api/agent/approvals/{id}
 *  body: { action: 'approve' | 'reject', reason?: string }
 *
 * Approve: kicks off executeApprovedDecision; the decision's stored mode is
 *          used for tool execution semantics (autonomous vs approval_only).
 * Reject:  marks the decision rejected and releases the queue row.
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
  const body = await req.json().catch(() => ({}))
  const action = body.action
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve|reject' }, { status: 400 })
  }

  const approval = await prisma.pendingApproval.findFirst({
    where: { id, orgId: org.id },
    include: { decision: true },
  })
  if (!approval) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (approval.decision.status !== 'pending') {
    return NextResponse.json(
      { error: `Decision already ${approval.decision.status}` },
      { status: 400 }
    )
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
    await logAudit({
      orgId: org.id,
      userId: user.id,
      action: 'advisor.apply',
      targetType: 'decision',
      targetId: approval.decisionId,
      metadata: { result: 'rejected', reason },
      req,
    })
    return NextResponse.json({ ok: true, decisionId: approval.decisionId, status: 'rejected' })
  }

  // Approve path — record approver, then execute.
  await prisma.decision.update({
    where: { id: approval.decisionId },
    data: { approvedBy: user.id, approvedAt: new Date() },
  })
  await prisma.pendingApproval.delete({ where: { id: approval.id } })
  const result = await executeApprovedDecision(
    org.id,
    approval.decisionId,
    approval.decision.mode as AgentMode
  )
  await logAudit({
    orgId: org.id,
    userId: user.id,
    action: 'advisor.apply',
    targetType: 'decision',
    targetId: approval.decisionId,
    metadata: { result: 'approved', execution: result.status },
    req,
  })
  return NextResponse.json({ ok: true, ...result })
}
