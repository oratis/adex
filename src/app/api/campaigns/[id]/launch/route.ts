import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { GoogleAdsClient } from '@/lib/platforms/google'
import { MetaAdsClient } from '@/lib/platforms/meta'
import { TikTokAdsClient } from '@/lib/platforms/tiktok'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    const { id } = await params

    const campaign = await prisma.campaign.findFirst({
      where: { id, userId: user.id },
      include: { budgets: true, adGroups: { include: { ads: { include: { creative: true } } } } },
    })
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    const auth = await prisma.platformAuth.findFirst({
      where: { userId: user.id, platform: campaign.platform, isActive: true },
    })
    if (!auth) return NextResponse.json({ error: `No ${campaign.platform} authorization found` }, { status: 400 })

    let result: unknown
    const budget = campaign.budgets[0]

    switch (campaign.platform) {
      case 'google': {
        const client = new GoogleAdsClient({
          accessToken: auth.accessToken!,
          refreshToken: auth.refreshToken!,
          customerId: auth.accountId!,
          developerToken: auth.apiKey || undefined,
        })
        result = await client.createCampaign(auth.accountId!, {
          name: campaign.name,
          budget: budget?.amount || 50,
          objective: campaign.objective || 'DISPLAY',
          startDate: campaign.startDate?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
          endDate: campaign.endDate?.toISOString().split('T')[0],
        })
        break
      }
      case 'meta': {
        const client = new MetaAdsClient({
          accessToken: auth.accessToken!,
          adAccountId: auth.accountId!,
        })
        result = await client.createCampaign({
          name: campaign.name,
          objective: campaign.objective || 'OUTCOME_AWARENESS',
          dailyBudget: budget?.type === 'daily' ? budget.amount : undefined,
          lifetimeBudget: budget?.type === 'lifetime' ? budget.amount : undefined,
        })
        break
      }
      case 'tiktok': {
        const client = new TikTokAdsClient({
          accessToken: auth.accessToken!,
          advertiserId: auth.accountId!,
        })
        result = await client.createCampaign({
          name: campaign.name,
          objective: campaign.objective || 'REACH',
          budget: budget?.amount || 50,
          budgetMode: budget?.type === 'daily' ? 'BUDGET_MODE_DAY' : 'BUDGET_MODE_TOTAL',
        })
        break
      }
    }

    await prisma.campaign.update({
      where: { id },
      data: { status: 'active' },
    })

    return NextResponse.json({ success: true, platformResponse: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Launch failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
