import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg, assertRole } from '@/lib/auth'
import { deleteFromGCS } from '@/lib/storage'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, org, role } = await requireAuthWithOrg()
    const { id } = await params

    const asset = await prisma.asset.findFirst({
      where: { id, orgId: org.id },
    })
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Uploader can always delete; otherwise require admin/owner
    if (asset.uploadedBy !== user.id) {
      try {
        assertRole(role, 'admin')
      } catch {
        return NextResponse.json(
          { error: 'Only the uploader or an org admin/owner can delete this asset' },
          { status: 403 }
        )
      }
    }

    if (asset.fileUrl?.startsWith('https://storage.googleapis.com/')) {
      await deleteFromGCS(asset.fileUrl).catch(() => {})
    }

    await prisma.asset.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
