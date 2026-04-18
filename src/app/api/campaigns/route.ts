import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

export async function GET() {
  try {
    const { org } = await requireAuthWithOrg()
    const campaigns = await prisma.campaign.findMany({
      where: { orgId: org.id },
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
    const { user, org } = await requireAuthWithOrg()
    const data = await req.json()

    const campaign = await prisma.campaign.create({
      data: {
        orgId: org.id,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create campaign'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
