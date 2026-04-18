import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

export async function GET() {
  try {
    const { org } = await requireAuthWithOrg()
    const budgets = await prisma.budget.findMany({
      where: { orgId: org.id },
      include: { campaign: true },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(budgets)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, org } = await requireAuthWithOrg()
    const data = await req.json()

    const budget = await prisma.budget.create({
      data: {
        orgId: org.id,
        userId: user.id,
        campaignId: data.campaignId,
        type: data.type || 'daily',
        amount: data.amount,
        currency: data.currency || 'USD',
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
      },
    })
    return NextResponse.json(budget)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create budget'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
