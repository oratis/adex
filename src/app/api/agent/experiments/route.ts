import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

export async function GET() {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const experiments = await prisma.experiment.findMany({
    where: { orgId: org.id },
    orderBy: { startedAt: 'desc' },
    include: { arms: true },
  })
  return NextResponse.json(experiments)
}

/**
 * POST — start a new experiment.
 *  body: { campaignLinkId, hypothesis, primaryMetric, durationHours?, minSampleSize?, arms: [{name, adLinkId, trafficShare}] }
 */
export async function POST(req: NextRequest) {
  let org, role
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
    role = ctx.role
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Owner/admin only' }, { status: 403 })
  }
  const body = await req.json()
  if (!body.campaignLinkId || !body.hypothesis || !body.primaryMetric || !Array.isArray(body.arms)) {
    return NextResponse.json(
      { error: 'campaignLinkId, hypothesis, primaryMetric, arms[] required' },
      { status: 400 }
    )
  }
  // Verify the campaign link belongs to org.
  const link = await prisma.platformLink.findFirst({
    where: { id: body.campaignLinkId, orgId: org.id, entityType: 'campaign' },
  })
  if (!link) return NextResponse.json({ error: 'campaignLinkId not in org' }, { status: 400 })
  const totalShare = body.arms.reduce(
    (s: number, a: { trafficShare?: number }) => s + (a.trafficShare ?? 0),
    0
  )
  if (Math.abs(totalShare - 1) > 0.01) {
    return NextResponse.json({ error: 'Arm traffic shares must sum to 1.0' }, { status: 400 })
  }
  const durationHours = Number(body.durationHours) || 168
  const exp = await prisma.experiment.create({
    data: {
      orgId: org.id,
      campaignLinkId: body.campaignLinkId,
      hypothesis: String(body.hypothesis).slice(0, 500),
      status: 'running',
      startedAt: new Date(),
      endsAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
      primaryMetric: String(body.primaryMetric),
      minSampleSize: Number(body.minSampleSize) || 1000,
      arms: {
        create: body.arms.map((a: { name: string; adLinkId: string; trafficShare: number }) => ({
          name: a.name,
          adLinkId: a.adLinkId,
          trafficShare: a.trafficShare,
        })),
      },
    },
    include: { arms: true },
  })
  return NextResponse.json(exp)
}
