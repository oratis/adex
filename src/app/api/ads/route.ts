import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

// POST /api/ads — create an Ad (and parent AdGroup if needed) under a Campaign.
export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuthWithOrg()
    const body = await req.json()

    const { campaignId, creativeId, name } = body
    if (!campaignId || !name) {
      return NextResponse.json({ error: 'campaignId and name are required' }, { status: 400 })
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, orgId: org.id },
    })
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (creativeId) {
      const creative = await prisma.creative.findFirst({
        where: { id: creativeId, orgId: org.id },
      })
      if (!creative) {
        return NextResponse.json({ error: 'Creative not found' }, { status: 404 })
      }
    }

    let adGroup = await prisma.adGroup.findFirst({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    })
    if (!adGroup) {
      adGroup = await prisma.adGroup.create({
        data: {
          campaignId,
          name: body.adGroupName || 'Default Ad Group',
        },
      })
    }

    const ad = await prisma.ad.create({
      data: {
        adGroupId: adGroup.id,
        creativeId: creativeId || null,
        name,
        headline: body.headline || null,
        description: body.description || null,
        callToAction: body.callToAction || null,
        destinationUrl: body.destinationUrl || null,
      },
      include: { creative: true, adGroup: true },
    })

    return NextResponse.json(ad)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create ad'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET /api/ads?campaignId=...
export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuthWithOrg()
    const campaignId = req.nextUrl.searchParams.get('campaignId')
    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId required' }, { status: 400 })
    }
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, orgId: org.id },
    })
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const ads = await prisma.ad.findMany({
      where: { adGroup: { campaignId } },
      include: { creative: true, adGroup: true },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(ads)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list ads'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
