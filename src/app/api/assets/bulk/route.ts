import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { deleteFromGCS } from '@/lib/storage'

// POST /api/assets/bulk — { action: 'delete' | 'tag', ids: string[], tags?: string }
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { action, ids, tags } = (await req.json()) as {
      action: 'delete' | 'tag'
      ids?: string[]
      tags?: string
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 })
    }

    // Only the uploader can modify their own assets.
    const owned = await prisma.asset.findMany({
      where: { id: { in: ids }, uploadedBy: user.id },
    })
    const ownedIds = owned.map((a) => a.id)
    const skipped = ids.length - ownedIds.length

    if (ownedIds.length === 0) {
      return NextResponse.json(
        { error: 'No assets owned by current user in selection', skipped },
        { status: 403 }
      )
    }

    if (action === 'delete') {
      // Best-effort GCS cleanup
      await Promise.all(
        owned
          .filter((a) => a.fileUrl?.startsWith('https://storage.googleapis.com/'))
          .map((a) => deleteFromGCS(a.fileUrl!).catch(() => {}))
      )
      const result = await prisma.asset.deleteMany({
        where: { id: { in: ownedIds } },
      })
      return NextResponse.json({ ok: true, deleted: result.count, skipped })
    }

    if (action === 'tag') {
      if (typeof tags !== 'string') {
        return NextResponse.json({ error: 'tags string required' }, { status: 400 })
      }
      const result = await prisma.asset.updateMany({
        where: { id: { in: ownedIds } },
        data: { tags },
      })
      return NextResponse.json({ ok: true, updated: result.count, skipped })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bulk op failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
