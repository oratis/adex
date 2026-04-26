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
  const campaignId = url.searchParams.get('campaignId') || undefined
  const sinceParam = url.searchParams.get('since') // ISO date
  const untilParam = url.searchParams.get('until')
  const take = Math.min(Number(url.searchParams.get('limit') || 50), 200)

  const where: Record<string, unknown> = { orgId: org.id }
  if (status) where.status = status
  if (severity) where.severity = severity

  // Tool + campaignId both filter on steps; combine into a single `some`
  // clause so AND semantics hold (decisions whose step matches BOTH).
  if (tool || campaignId) {
    const stepWhere: Record<string, unknown> = {}
    if (tool) stepWhere.toolName = tool
    if (campaignId) {
      // Match steps whose toolInput JSON contains "campaignId":"…". We can't
      // index into JSON without Postgres ops, so a substring match on the
      // serialized field is the pragmatic shortcut.
      stepWhere.toolInput = { contains: `"campaignId":"${campaignId}"` }
    }
    where.steps = { some: stepWhere }
  }

  const dateFilter: Record<string, Date> = {}
  if (sinceParam) {
    const t = new Date(sinceParam)
    if (!Number.isNaN(t.getTime())) dateFilter.gte = t
  }
  if (untilParam) {
    const t = new Date(untilParam)
    if (!Number.isNaN(t.getTime())) dateFilter.lte = t
  }
  if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter

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
