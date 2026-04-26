import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin, isPlatformAdmin } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/admin/users — list every user with platform-admin status.
 * PUT /api/admin/users — body: { userId, isPlatformAdmin: boolean }
 *   Promote / demote a user. Self-demotion is allowed (don't lock yourself
 *   out by always-true env var fallback).
 */
export async function GET() {
  let admin
  try {
    admin = await requirePlatformAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  void admin
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      isPlatformAdmin: true,
      createdAt: true,
      memberships: { select: { orgId: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(
    users.map((u) => ({
      ...u,
      // Effective admin status — true if column OR env says so
      effectiveAdmin: isPlatformAdmin({ email: u.email, isPlatformAdmin: u.isPlatformAdmin }),
      orgs: u.memberships.length,
    }))
  )
}

export async function PUT(req: NextRequest) {
  let admin
  try {
    admin = await requirePlatformAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  const body = await req.json().catch(() => ({}))
  if (typeof body.userId !== 'string' || typeof body.isPlatformAdmin !== 'boolean') {
    return NextResponse.json(
      { error: 'userId and isPlatformAdmin (boolean) required' },
      { status: 400 }
    )
  }
  const target = await prisma.user.findUnique({ where: { id: body.userId } })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const updated = await prisma.user.update({
    where: { id: body.userId },
    data: { isPlatformAdmin: body.isPlatformAdmin },
    select: { id: true, email: true, isPlatformAdmin: true },
  })
  const m = await prisma.orgMembership.findFirst({
    where: { userId: admin.id },
    orderBy: { createdAt: 'asc' },
  })
  if (m) {
    await logAudit({
      orgId: m.orgId,
      userId: admin.id,
      action: 'member.role_change',
      targetType: 'user',
      targetId: target.id,
      metadata: { isPlatformAdmin: body.isPlatformAdmin, targetEmail: target.email },
      req,
    })
  }
  return NextResponse.json(updated)
}
