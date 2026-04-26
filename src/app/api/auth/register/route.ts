import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  hashPassword,
  createSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  ensurePersonalOrg,
} from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { validateInviteCode, consumeInviteCode } from '@/lib/invite-codes'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  // 5 signups per hour per IP — stops account farming
  const rl = checkRateLimit(req, { key: 'register', limit: 5, windowMs: 60 * 60_000 })
  if (!rl.ok) return rateLimitResponse(rl)

  try {
    const { email, password, name, inviteCode } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Invite-only platform: every new account must redeem a valid code
    // unless `INVITE_CODES_DISABLED=true` is set (escape hatch for ops).
    let codeId: string | null = null
    if (process.env.INVITE_CODES_DISABLED !== 'true') {
      if (typeof inviteCode !== 'string' || inviteCode.trim().length === 0) {
        return NextResponse.json(
          { error: 'Invite code required — request one from a platform admin' },
          { status: 400 }
        )
      }
      const v = await validateInviteCode(inviteCode)
      if (!v.ok) {
        return NextResponse.json({ error: v.reason }, { status: 400 })
      }
      codeId = v.codeId
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: await hashPassword(password),
        name: name.trim(),
      },
    })

    // Consume the invite code AFTER user exists. If race lost (someone used
    // it in parallel), roll back the user creation rather than leave an
    // orphan account.
    if (codeId) {
      const consumed = await consumeInviteCode(codeId, user.id)
      if (!consumed) {
        await prisma.user.delete({ where: { id: user.id } })
        return NextResponse.json(
          { error: 'Invite code was already used by someone else — request a new one' },
          { status: 400 }
        )
      }
    }

    // Every user gets a personal workspace on sign-up
    await ensurePersonalOrg(user)

    const token = await createSession({
      userId: user.id,
      userAgent: req.headers.get('user-agent'),
      ipAddress:
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        null,
    })
    const response = NextResponse.json({ id: user.id, email: user.email, name: user.name })
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    })

    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
