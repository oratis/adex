import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { apiError } from '@/lib/api-error'

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function POST(req: NextRequest) {
  // 20 attempts / hour / IP — prevents brute-forcing the reset token
  const rl = checkRateLimit(req, {
    key: 'password-reset-confirm',
    limit: 20,
    windowMs: 60 * 60_000,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  try {
    const { token, password } = await req.json()

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    const tokenHash = hashToken(token)
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    })

    if (!record) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link' },
        { status: 400 }
      )
    }
    if (record.usedAt) {
      return NextResponse.json(
        { error: 'This reset link has already been used' },
        { status: 400 }
      )
    }
    if (record.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'This reset link has expired' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({ where: { id: record.userId } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Atomically: set new password AND mark token used
    const newHash = await hashPassword(password)
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password: newHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate every other pending token for the same user
      prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      }),
    ])

    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError(err, {
      route: 'POST /api/auth/password-reset/confirm',
      status: 500,
      userMessage: 'Password reset failed — please try again',
    })
  }
}
