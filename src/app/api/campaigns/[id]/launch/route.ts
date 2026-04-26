import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { fireWebhook } from '@/lib/webhooks'
import { getAdapter, isAdaptablePlatform } from '@/lib/platforms/registry'
import { upsertPlatformLink } from '@/lib/platforms/links'
import { PlatformError, type LaunchCampaignInput } from '@/lib/platforms/adapter'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, org } = await requireAuthWithOrg()
    const { id } = await params

    const campaign = await prisma.campaign.findFirst({
      where: { id, orgId: org.id },
      include: { budgets: true, adGroups: { include: { ads: { include: { creative: true } } } } },
    })
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    if (!isAdaptablePlatform(campaign.platform)) {
      return NextResponse.json(
        { error: `Launch via adapter not yet supported for ${campaign.platform}` },
        { status: 400 }
      )
    }

    const auth = await prisma.platformAuth.findFirst({
      where: { orgId: org.id, platform: campaign.platform, isActive: true },
    })
    if (!auth)
      return NextResponse.json(
        { error: `No ${campaign.platform} authorization found` },
        { status: 400 }
      )

    const adapter = getAdapter(campaign.platform, auth)
    const budget = campaign.budgets[0]
    const launchInput: LaunchCampaignInput = {
      name: campaign.name,
      objective: campaign.objective || undefined,
      dailyBudget: budget?.type === 'daily' ? budget.amount : undefined,
      lifetimeBudget: budget?.type === 'lifetime' ? budget.amount : undefined,
      startDate: campaign.startDate?.toISOString().split('T')[0],
      endDate: campaign.endDate?.toISOString().split('T')[0],
      targetCountries: campaign.targetCountries
        ? (JSON.parse(campaign.targetCountries) as string[])
        : undefined,
      ageMin: campaign.ageMin ?? undefined,
      ageMax: campaign.ageMax ?? undefined,
      gender: (campaign.gender as 'all' | 'male' | 'female' | undefined) || undefined,
      interests: campaign.targetInterests
        ? (JSON.parse(campaign.targetInterests) as string[])
        : undefined,
    }

    let result
    try {
      result = await adapter.launchCampaign(launchInput)
    } catch (err) {
      if (err instanceof PlatformError) {
        await prisma.campaign.update({
          where: { id },
          data: { syncError: `[${err.code}] ${err.message}`.slice(0, 500), syncedAt: new Date() },
        })
        return NextResponse.json(
          { error: `${campaign.platform}: ${err.message}`, code: err.code },
          { status: 502 }
        )
      }
      throw err
    }

    await upsertPlatformLink({
      orgId: org.id,
      platform: campaign.platform,
      accountId: adapter.accountId,
      entityType: 'campaign',
      localEntityId: campaign.id,
      platformEntityId: result.platformCampaignId,
      metadata: { launchedAt: new Date().toISOString() },
    })

    await prisma.campaign.update({
      where: { id },
      data: {
        status: 'active',
        desiredStatus: 'active',
        platformCampaignId: result.platformCampaignId,
        syncError: null,
        syncedAt: new Date(),
        syncedStatus: 'paused', // adapters launch in PAUSED; sync worker will refresh once user activates
      },
    })

    await logAudit({
      orgId: org.id,
      userId: user.id,
      action: 'campaign.launch',
      targetType: 'campaign',
      targetId: id,
      metadata: {
        platform: campaign.platform,
        name: campaign.name,
        platformCampaignId: result.platformCampaignId,
      },
      req,
    })
    fireWebhook({
      orgId: org.id,
      event: 'campaign.launched',
      data: {
        campaignId: id,
        name: campaign.name,
        platform: campaign.platform,
        platformCampaignId: result.platformCampaignId,
        launchedBy: user.id,
      },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      platformCampaignId: result.platformCampaignId,
      platformResponse: result.raw,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Launch failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
