import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  hashPassword,
  signSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  ensurePersonalOrg,
} from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  // 5 signups per hour per IP — stops account farming
  const rl = checkRateLimit(req, { key: 'register', limit: 5, windowMs: 60 * 60_000 })
  if (!rl.ok) return rateLimitResponse(rl)

  try {
    const { email, password, name } = await req.json()

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

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: hashPassword(password),
        name: name.trim(),
      },
    })

    // Every user gets a personal workspace on sign-up
    await ensurePersonalOrg(user)

    const token = signSessionToken(user.id, SESSION_MAX_AGE)
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
