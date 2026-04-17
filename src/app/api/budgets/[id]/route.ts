import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth()
    const { id } = await params
    const data = await req.json()

    const updateData: Record<string, unknown> = {}
    if (data.type !== undefined) updateData.type = data.type
    if (data.amount !== undefined) updateData.amount = Number(data.amount)
    if (data.currency !== undefined) updateData.currency = data.currency
    if (data.campaignId !== undefined) updateData.campaignId = data.campaignId || null
    if (data.startDate !== undefined)
      updateData.startDate = data.startDate ? new Date(data.startDate) : null
    if (data.endDate !== undefined)
      updateData.endDate = data.endDate ? new Date(data.endDate) : null

    const result = await prisma.budget.updateMany({
      where: { id, userId: user.id },
      data: updateData,
    })

    if (result.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const updated = await prisma.budget.findUnique({
      where: { id },
      include: { campaign: true },
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
    const result = await prisma.budget.deleteMany({
      where: { id, userId: user.id },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
