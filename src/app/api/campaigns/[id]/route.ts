import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { org } = await requireAuthWithOrg()
    const { id } = await params
    const campaign = await prisma.campaign.findFirst({
      where: { id, orgId: org.id },
      include: { budgets: true, adGroups: { include: { ads: { include: { creative: true } } } }, reports: true },
    })
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(campaign)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { org } = await requireAuthWithOrg()
    const { id } = await params
    const data = await req.json()

    const campaign = await prisma.campaign.updateMany({
      where: { id, orgId: org.id },
      data: {
        name: data.name,
        platform: data.platform,
        status: data.status,
        objective: data.objective,
        targetCountries: data.targetCountries ? JSON.stringify(data.targetCountries) : undefined,
        targetAudience: data.targetAudience ? JSON.stringify(data.targetAudience) : undefined,
        targetInterests: data.targetInterests ? JSON.stringify(data.targetInterests) : undefined,
        ageMin: data.ageMin,
        ageMax: data.ageMax,
        gender: data.gender,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
    })

    return NextResponse.json(campaign)
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { org } = await requireAuthWithOrg()
    const { id } = await params
    await prisma.campaign.deleteMany({ where: { id, orgId: org.id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
