import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mailer'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const TOKEN_TTL_MINUTES = 60

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function resetUrl(token: string): string {
  const base = process.env.PUBLIC_URL || 'http://localhost:3000'
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
  return `${base}${basePath}/reset-password?token=${encodeURIComponent(token)}`
}

export async function POST(req: NextRequest) {
  // Strict: 5 reset requests / hour / IP to prevent email abuse
  const rl = checkRateLimit(req, {
    key: 'password-reset-request',
    limit: 5,
    windowMs: 60 * 60_000,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  // Always return a generic response to avoid leaking whether
  // an email is registered.
  const genericResponse = NextResponse.json({
    ok: true,
    message:
      'If that email is registered, a reset link has been sent. Check your inbox.',
  })

  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return genericResponse
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return genericResponse
    }

    // Invalidate any existing active tokens for this user to prevent accumulation
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000)

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    })

    const url = resetUrl(rawToken)
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
        <h2 style="color:#2563eb;">Reset your Adex password</h2>
        <p>We received a request to reset the password on your Adex account. Click the button below to choose a new password. This link expires in ${TOKEN_TTL_MINUTES} minutes.</p>
        <p style="margin: 24px 0;">
          <a href="${url}" style="display:inline-block; padding:10px 16px; background:#2563eb; color:#fff; border-radius:8px; text-decoration:none; font-weight:600;">Reset Password</a>
        </p>
        <p style="color:#6b7280; font-size:13px;">Or paste this URL into your browser:<br/><code style="word-break:break-all;">${url}</code></p>
        <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0;"/>
        <p style="color:#9ca3af; font-size:12px;">If you didn\u2019t request this, you can safely ignore this email \u2014 your password won\u2019t change.</p>
      </div>
    `

    const mailResult = await sendMail({
      to: user.email,
      subject: 'Reset your Adex password',
      html,
    })

    // In non-production, or when SMTP isn\u2019t configured, expose the
    // URL directly to make local testing possible. This is a
    // deliberate affordance for self-hosting.
    if (!mailResult.ok && process.env.NODE_ENV !== 'production') {
      return NextResponse.json({
        ok: true,
        devResetUrl: url,
        emailError: mailResult.reason,
        message:
          'SMTP not configured; showing reset URL for dev use. Configure SMTP_* env vars to send email.',
      })
    }

    return genericResponse
  } catch (err) {
    console.error('password-reset/request failed:', err)
    // Still return generic response to avoid enumeration
    return genericResponse
  }
}
