import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  verifyPasswordDetailed,
  rehashIfLegacy,
  createSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { apiError } from '@/lib/api-error'

export async function POST(req: NextRequest) {
  // 10 attempts / minute / IP — protects against credential stuffing
  const rl = checkRateLimit(req, { key: 'login', limit: 10, windowMs: 60_000 })
  if (!rl.ok) return rateLimitResponse(rl)

  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }
    const { valid, needsUpgrade } = await verifyPasswordDetailed(password, user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }
    // Transparent upgrade SHA-256 → bcrypt
    if (needsUpgrade) {
      rehashIfLegacy(user.id, password, user.password).catch(() => {})
    }

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
    return apiError(error, {
      route: 'POST /api/auth/login',
      status: 500,
      userMessage: 'Login failed — please try again',
    })
  }
}
