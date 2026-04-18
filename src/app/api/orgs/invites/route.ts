import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg, assertRole } from '@/lib/auth'
import { sendMail } from '@/lib/mailer'
import { logAudit } from '@/lib/audit'

const TTL_DAYS = 7

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function inviteUrl(token: string): string {
  const base = process.env.PUBLIC_URL || 'http://localhost:3000'
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
  return `${base}${basePath}/accept-invite?token=${encodeURIComponent(token)}`
}

// GET /api/orgs/invites — list pending invites for the current org
export async function GET() {
  try {
    const { org, role } = await requireAuthWithOrg()
    assertRole(role, 'admin')

    const invites = await prisma.orgInvite.findMany({
      where: { orgId: org.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(
      invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        invitedBy: i.invitedBy,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      }))
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unauthorized'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}

// POST /api/orgs/invites — send an invite email
// body: { email, role? }
export async function POST(req: NextRequest) {
  try {
    const { user, org, role } = await requireAuthWithOrg()
    assertRole(role, 'admin')

    const { email, role: inviteRole = 'member' } = await req.json()
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }
    if (!['admin', 'member'].includes(inviteRole)) {
      return NextResponse.json({ error: 'Role must be admin or member' }, { status: 400 })
    }

    // If already a member, refuse
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      const alreadyMember = await prisma.orgMembership.findUnique({
        where: { orgId_userId: { orgId: org.id, userId: existing.id } },
      })
      if (alreadyMember) {
        return NextResponse.json({ error: 'Already a member' }, { status: 400 })
      }
    }

    // Invalidate any pending invite for same email+org
    await prisma.orgInvite.updateMany({
      where: { orgId: org.id, email, acceptedAt: null },
      data: { acceptedAt: new Date() },
    })

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000)

    const invite = await prisma.orgInvite.create({
      data: {
        orgId: org.id,
        email,
        role: inviteRole,
        tokenHash,
        invitedBy: user.id,
        expiresAt,
      },
    })

    const url = inviteUrl(rawToken)
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
        <h2 style="color:#2563eb;">You\u2019re invited to ${org.name} on Adex</h2>
        <p>${user.name || user.email} invited you to join <strong>${org.name}</strong> as <strong>${inviteRole}</strong>.</p>
        <p style="margin: 24px 0;">
          <a href="${url}" style="display:inline-block; padding:10px 16px; background:#2563eb; color:#fff; border-radius:8px; text-decoration:none; font-weight:600;">Accept Invite</a>
        </p>
        <p style="color:#6b7280; font-size:13px;">Or paste this URL:<br/><code style="word-break:break-all;">${url}</code></p>
        <p style="color:#9ca3af; font-size:12px; margin-top:32px;">This invite expires in ${TTL_DAYS} days.</p>
      </div>
    `

    const mailResult = await sendMail({
      to: email,
      subject: `You\u2019re invited to ${org.name} on Adex`,
      html,
    })

    await logAudit({
      orgId: org.id,
      userId: user.id,
      action: 'member.invite',
      targetType: 'invite',
      targetId: invite.id,
      metadata: { email, role: inviteRole },
      req,
    })

    // Dev affordance: expose URL when SMTP not configured
    if (!mailResult.ok && process.env.NODE_ENV !== 'production') {
      return NextResponse.json({
        ok: true,
        inviteId: invite.id,
        devInviteUrl: url,
        emailError: mailResult.reason,
      })
    }

    return NextResponse.json({ ok: true, inviteId: invite.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invite failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
