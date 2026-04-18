import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, ACTIVE_ORG_COOKIE } from '@/lib/auth'

// POST /api/orgs/switch — set the active org cookie
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { orgId } = await req.json()
    if (!orgId) {
      return NextResponse.json({ error: 'orgId required' }, { status: 400 })
    }

    // Must be a member of the target org
    const membership = await prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId, userId: user.id } },
    })
    if (!membership) {
      return NextResponse.json({ error: 'Not a member of that org' }, { status: 403 })
    }

    const response = NextResponse.json({ ok: true, orgId })
    response.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Switch failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
