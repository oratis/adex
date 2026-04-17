import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

async function verifyOwnership(adId: string, userId: string) {
  const ad = await prisma.ad.findUnique({
    where: { id: adId },
    include: { adGroup: { include: { campaign: true } } },
  })
  if (!ad) return null
  if (ad.adGroup.campaign.userId !== userId) return null
  return ad
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth()
    const { id } = await params
    const data = await req.json()

    const ad = await verifyOwnership(id, user.id)
    if (!ad) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updateData: Record<string, unknown> = {}
    for (const key of ['name', 'headline', 'description', 'callToAction', 'destinationUrl', 'status']) {
      if (data[key] !== undefined) updateData[key] = data[key]
    }
    if (data.creativeId !== undefined) updateData.creativeId = data.creativeId || null

    const updated = await prisma.ad.update({
      where: { id },
      data: updateData,
      include: { creative: true },
    })
    return NextResponse.json(updated)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth()
    const { id } = await params
    const ad = await verifyOwnership(id, user.id)
    if (!ad) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.ad.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
