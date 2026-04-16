import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try {
    const user = await requireAuth()
    const campaigns = await prisma.campaign.findMany({
      where: { userId: user.id },
      include: { budgets: true, adGroups: { include: { ads: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(campaigns)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const data = await req.json()

    const campaign = await prisma.campaign.create({
      data: {
        userId: user.id,
        name: data.name,
        platform: data.platform,
        objective: data.objective,
        targetCountries: data.targetCountries ? JSON.stringify(data.targetCountries) : null,
        targetAudience: data.targetAudience ? JSON.stringify(data.targetAudience) : null,
        targetInterests: data.targetInterests ? JSON.stringify(data.targetInterests) : null,
        ageMin: data.ageMin,
        ageMax: data.ageMax,
        gender: data.gender,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
      },
    })

    return NextResponse.json(campaign)
  } catch {
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
}
