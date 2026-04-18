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
    if (!password || !verifyPassword(password, user.password)) {
      return NextResponse.json(
        { error: 'Password is incorrect' },
        { status: 401 }
      )
    }

    // Clean up auth tokens first, then the user (cascades)
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
