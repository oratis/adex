import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

export async function GET(req: NextRequest) {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || undefined
  const severity = url.searchParams.get('severity') || undefined
  const tool = url.searchParams.get('tool') || undefined
  const take = Math.min(Number(url.searchParams.get('limit') || 50), 200)
  const where: Record<string, unknown> = { orgId: org.id }
  if (status) where.status = status
  if (severity) where.severity = severity
  if (tool) where.steps = { some: { toolName: tool } }
  const decisions = await prisma.decision.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      steps: { orderBy: { stepIndex: 'asc' } },
      outcome: true,
      approval: true,
    },
  })
  return NextResponse.json(decisions)
}
