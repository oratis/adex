import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { requireAuth, ACTIVE_ORG_COOKIE } from '@/lib/auth'

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// POST /api/orgs/accept — body: { token }
// Accepts an invite for the CURRENTLY LOGGED IN user (regardless of what
// email the invite was sent to — a future tightening could require
// email match, but for v1 we accept any authenticated acceptance).
export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { token } = await req.json()
    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 })
    }

    const tokenHash = hashToken(token)
    const invite = await prisma.orgInvite.findUnique({
      where: { tokenHash },
      include: { org: true },
    })

    if (!invite) {
      return NextResponse.json({ error: 'Invalid invite link' }, { status: 400 })
    }
    if (invite.acceptedAt) {
      return NextResponse.json({ error: 'This invite has already been used' }, { status: 400 })
    }
    if (invite.expiresAt < new Date()) {
      return NextResponse.json({ error: 'This invite has expired' }, { status: 400 })
    }

    // Invite email should match the logged-in user's email
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return NextResponse.json(
        {
          error: `This invite is for ${invite.email}. Log in with that account to accept.`,
        },
        { status: 403 }
      )
    }

    // If already a member, just mark accepted
    const existing = await prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId: invite.orgId, userId: user.id } },
    })

    if (!existing) {
      await prisma.$transaction([
        prisma.orgMembership.create({
          data: { orgId: invite.orgId, userId: user.id, role: invite.role },
        }),
        prisma.orgInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        }),
      ])
    } else {
      await prisma.orgInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      })
    }

    const response = NextResponse.json({
      ok: true,
      org: { id: invite.org.id, name: invite.org.name, slug: invite.org.slug },
    })
    // Auto-switch to the newly-joined org
    response.cookies.set(ACTIVE_ORG_COOKIE, invite.orgId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Accept failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
