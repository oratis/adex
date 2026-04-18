import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth'

export async function POST() {
  // Revoke the Session row (if any) so the token is dead server-side.
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    const payload = verifySessionToken(token)
    if (payload?.sid) {
      await prisma.session
        .update({
          where: { id: payload.sid },
          data: { revokedAt: new Date() },
        })
        .catch(() => {}) // session might already be gone
    }
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.delete(SESSION_COOKIE)
  return response
}
