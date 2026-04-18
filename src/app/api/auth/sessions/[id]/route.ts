import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

// DELETE /api/auth/sessions/[id] — revoke a single session
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth()
    const { id } = await params
    const result = await prisma.session.updateMany({
      where: { id, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
