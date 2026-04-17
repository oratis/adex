import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { deleteFromGCS } from '@/lib/storage'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth()
    const { id } = await params
    const creative = await prisma.creative.findFirst({
      where: { id, userId: user.id },
    })
    if (!creative) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(creative)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth()
    const { id } = await params
    const data = await req.json()

    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.prompt !== undefined) updateData.prompt = data.prompt
    if (data.status !== undefined) updateData.status = data.status

    const result = await prisma.creative.updateMany({
      where: { id, userId: user.id },
      data: updateData,
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const updated = await prisma.creative.findUnique({ where: { id } })
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

    const creative = await prisma.creative.findFirst({
      where: { id, userId: user.id },
    })
    if (!creative) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Best-effort GCS cleanup for uploaded creatives
    if (creative.source === 'upload' && creative.fileUrl) {
      try {
        await deleteFromGCS(creative.fileUrl)
      } catch {
        // ignore storage cleanup errors; DB delete still proceeds
      }
    }

    await prisma.creative.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
