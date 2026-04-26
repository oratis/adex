import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

export async function GET(_req: NextRequest) {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const approvals = await prisma.pendingApproval.findMany({
    where: { orgId: org.id, decision: { status: 'pending' } },
    orderBy: { createdAt: 'desc' },
    include: { decision: { include: { steps: { orderBy: { stepIndex: 'asc' } } } } },
  })
  return NextResponse.json(approvals)
}
