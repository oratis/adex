import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg, assertRole } from '@/lib/auth'

// GET /api/orgs/audit — paginated audit trail for the current org.
// Admin/owner only. Supports ?limit=100&before=<iso-date>
export async function GET(req: NextRequest) {
  try {
    const { org, role } = await requireAuthWithOrg()
    assertRole(role, 'admin')

    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50', 10), 200)
    const before = req.nextUrl.searchParams.get('before')

    const events = await prisma.auditEvent.findMany({
      where: {
        orgId: org.id,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Enrich with user display names in a single query
    const userIds = Array.from(
      new Set(events.map((e) => e.userId).filter((x): x is string => !!x))
    )
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userMap = new Map(users.map((u) => [u.id, u]))

    return NextResponse.json(
      events.map((e) => ({
        id: e.id,
        userId: e.userId,
        userName: e.userId
          ? userMap.get(e.userId)?.name || userMap.get(e.userId)?.email || 'Unknown'
          : 'System',
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
        ipAddress: e.ipAddress,
        createdAt: e.createdAt,
      }))
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unauthorized'
    return NextResponse.json({ error: message }, { status: 403 })
  }
}
