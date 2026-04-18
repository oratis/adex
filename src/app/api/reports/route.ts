import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuthWithOrg()
    const searchParams = req.nextUrl.searchParams
    const platform = searchParams.get('platform')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const campaignId = searchParams.get('campaignId')

    const where: Record<string, unknown> = { orgId: org.id }
    if (platform) where.platform = platform
    if (campaignId) where.campaignId = campaignId
    if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) }
    }

    const reports = await prisma.report.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 500,
    })
    return NextResponse.json(reports)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
