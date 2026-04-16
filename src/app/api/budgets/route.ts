import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try {
    const user = await requireAuth()
    const budgets = await prisma.budget.findMany({
      where: { userId: user.id },
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
    const user = await requireAuth()
    const data = await req.json()

    const budget = await prisma.budget.create({
      data: {
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
  } catch {
    return NextResponse.json({ error: 'Failed to create budget' }, { status: 500 })
  }
}
