import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  requireAuth,
  verifyPassword,
  SESSION_COOKIE,
} from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

// DELETE /api/auth/delete-account
// Body: { password: string, confirm: string }  where confirm === "DELETE"
// Destructive, irreversible. Cascades through schema (User → PlatformAuth,
// Campaign, Creative, Budget, Report via onDelete: Cascade).
export async function DELETE(req: NextRequest) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Very strict: 3 attempts / hour / user
  const rl = checkRateLimit(req, {
    key: 'delete-account',
    limit: 3,
    windowMs: 60 * 60_000,
    identity: user.id,
  })
  if (!rl.ok) return rateLimitResponse(rl)

  try {
    const { password, confirm } = await req.json()

    if (confirm !== 'DELETE') {
      return NextResponse.json(
        { error: 'Type DELETE exactly to confirm account deletion' },
        { status: 400 }
      )
    }
    if (!password || !(await verifyPassword(password, user.password))) {
      return NextResponse.json(
        { error: 'Password is incorrect' },
        { status: 401 }
      )
    }

    // Delete orgs where this user is the sole owner (cascades to all
    // org resources — campaigns, reports, etc). For shared orgs, remove
    // just the membership.
    const memberships = await prisma.orgMembership.findMany({
      where: { userId: user.id },
      include: { org: { include: { members: { where: { role: 'owner' } } } } },
    })
    for (const m of memberships) {
      const ownerCount = m.org.members.length
      if (m.role === 'owner' && ownerCount <= 1) {
        // Sole owner → delete the whole org
        await prisma.organization.delete({ where: { id: m.orgId } })
      }
    }

    // Clean up auth tokens first, then the user (cascades remaining)
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })
    await prisma.user.delete({ where: { id: user.id } })

    const response = NextResponse.json({ ok: true })
    response.cookies.delete(SESSION_COOKIE)
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Account deletion failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
