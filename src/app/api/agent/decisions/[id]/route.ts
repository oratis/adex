import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const decision = await prisma.decision.findFirst({
    where: { id, orgId: org.id },
    include: {
      steps: { orderBy: { stepIndex: 'asc' } },
      outcome: true,
      approval: true,
    },
  })
  if (!decision) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(decision)
}
