import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createSession, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { validateInviteCode } from '@/lib/invite-codes'
import { sendMail } from '@/lib/mailer'
import { apiError } from '@/lib/api-error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

class InviteRaceError extends Error {}

function welcomeEmailHtml(name: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://adexads.com'
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #111827;">
      <h2 style="color:#2563eb;">欢迎来到 Adex · Welcome to Adex</h2>
      <p>Hi ${name.replace(/[<>&]/g, '')},</p>
      <p>账号创建完成。下面是建议的 4 步上手顺序：</p>
      <ol style="line-height: 1.7;">
        <li><strong>接广告平台</strong> · Connect a platform — Settings → Platform Auth (Google / Meta / TikTok)</li>
        <li><strong>建第一条 Campaign</strong> · 也可以在 /setup 一键加载 demo 数据</li>
        <li><strong>试 AI Advisor</strong> · 点 /advisor → "Get advice" 看 Claude 怎么建议</li>
        <li><strong>开 Agent shadow 模式</strong> · 让 AI 观察一周再升级到自动</li>
      </ol>
      <p>
        <a href="${baseUrl}/setup" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500;">
          打开上手向导 →
        </a>
      </p>
      <p style="color:#6b7280; font-size: 13px; margin-top: 24px;">
        遇到问题？看 <a href="${baseUrl.replace(/\/$/, '')}/docs/user-guide" style="color:#2563eb;">用户操作指南</a> 的 Part 5（出问题怎么办），或回复这封邮件。
      </p>
      <p style="color:#9ca3af; font-size: 12px; margin-top: 32px;">
        Adex · 自动化广告投放平台
      </p>
    </div>
  `
}

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

    // Audit High #16: create user + consume invite + personal org atomically.
    // Previously these were 3 sequential statements with hand-rolled rollback
    // (delete user on invite race), which leaked half-created accounts when
    // the org create step crashed. $transaction throws on any failure and
    // automatically rolls everything back.
    const passwordHash = await hashPassword(password)
    const trimmedName = name.trim()

    let user: Awaited<ReturnType<typeof prisma.user.create>>
    try {
      user = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: { email, password: passwordHash, name: trimmedName },
        })

        if (codeId) {
          const result = await tx.inviteCode.updateMany({
            where: { id: codeId, usedAt: null, revokedAt: null },
            data: { usedAt: new Date(), usedByUserId: u.id },
          })
          if (result.count !== 1) {
            // Throw to roll back the user create above.
            throw new InviteRaceError(
              'Invite code was already used by someone else — request a new one'
            )
          }
        }

        // Inline personal-org creation (mirrors ensurePersonalOrg). New user,
        // so we can skip the existing-membership check.
        const base = (u.name || u.email.split('@')[0])
          .replace(/[^a-zA-Z0-9]+/g, '-')
          .toLowerCase()
        const slug = `ws-${base.slice(0, 20)}-${u.id.slice(0, 6)}`
        const orgName = `${u.name || u.email.split('@')[0]}'s workspace`
        await tx.organization.create({
          data: {
            name: orgName,
            slug,
            createdBy: u.id,
            members: { create: { userId: u.id, role: 'owner' } },
          },
        })
        return u
      })
    } catch (err) {
      if (err instanceof InviteRaceError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }

    // Best-effort welcome email — never block registration on SMTP issues.
    // If SMTP isn't configured, sendMail returns ok:false and we move on.
    void sendMail({
      to: user.email,
      subject: '欢迎来到 Adex · Welcome to Adex',
      html: welcomeEmailHtml(user.name || user.email.split('@')[0]),
    }).catch(() => {})

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
      route: 'POST /api/auth/register',
      status: 500,
      userMessage: 'Registration failed — please try again',
    })
  }
}
