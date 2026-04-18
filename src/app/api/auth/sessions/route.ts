import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { requireAuth, verifySessionToken, SESSION_COOKIE } from '@/lib/auth'

// GET /api/auth/sessions — list active sessions for the current user
export async function GET() {
  try {
    const user = await requireAuth()
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    const currentSid = token ? verifySessionToken(token)?.sid : null

    const sessions = await prisma.session.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
      },
    })
    return NextResponse.json(
      sessions.map((s) => ({
        ...s,
        isCurrent: s.id === currentSid,
      }))
    )
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

// DELETE /api/auth/sessions — revoke every session except the current one
export async function DELETE() {
  try {
    const user = await requireAuth()
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    const currentSid = token ? verifySessionToken(token)?.sid : null

    await prisma.session.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
        ...(currentSid ? { id: { not: currentSid } } : {}),
      },
      data: { revokedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
