import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { deleteFromGCS } from '@/lib/storage'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    const { id } = await params

    // Only the uploader can delete
    const asset = await prisma.asset.findFirst({ where: { id } })
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (asset.uploadedBy !== user.id) {
      return NextResponse.json({ error: 'Not authorized to delete this asset' }, { status: 403 })
    }

    // Delete file from GCS if it's a GCS URL
    if (asset.fileUrl?.startsWith('https://storage.googleapis.com/')) {
      await deleteFromGCS(asset.fileUrl).catch(() => {})
    }

    await prisma.asset.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
