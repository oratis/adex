import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg, assertRole } from '@/lib/auth'
import { deleteFromGCS } from '@/lib/storage'

// POST /api/assets/bulk — { action: 'delete' | 'tag', ids: string[], tags?: string }
export async function POST(req: NextRequest) {
  try {
    const { user, org, role } = await requireAuthWithOrg()
    const { action, ids, tags } = (await req.json()) as {
      action: 'delete' | 'tag'
      ids?: string[]
      tags?: string
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 })
    }

    // Scope to current org. Non-admin members can only modify what they
    // uploaded; admins/owners can modify any org asset.
    const isAdmin = (() => {
      try { assertRole(role, 'admin'); return true } catch { return false }
    })()

    const targetFilter: Record<string, unknown> = {
      id: { in: ids },
      orgId: org.id,
    }
    if (!isAdmin) targetFilter.uploadedBy = user.id

    const owned = await prisma.asset.findMany({ where: targetFilter })
    const ownedIds = owned.map((a) => a.id)
    const skipped = ids.length - ownedIds.length

    if (ownedIds.length === 0) {
      return NextResponse.json(
        { error: 'No assets in the current org you are allowed to modify', skipped },
        { status: 403 }
      )
    }

    if (action === 'delete') {
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
