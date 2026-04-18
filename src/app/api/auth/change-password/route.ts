import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, hashPassword, verifyPassword } from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 10 attempts / hour / user — prevents brute-forcing the current password
  const rl = checkRateLimit(req, {
    key: 'change-password',
    limit: 10,
    windowMs: 60 * 60_000,
    identity: user.id,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  try {
    const { currentPassword, newPassword } = await req.json()

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'currentPassword and newPassword required' },
        { status: 400 }
      )
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      )
    }
    if (!(await verifyPassword(currentPassword, user.password))) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 }
      )
    }
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'New password must be different from current' },
        { status: 400 }
      )
    }

    const newHash = await hashPassword(newPassword)
    await prisma.user.update({
      where: { id: user.id },
      data: { password: newHash },
    })

    // Invalidate all pending password-reset tokens when password changes
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Password change failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
