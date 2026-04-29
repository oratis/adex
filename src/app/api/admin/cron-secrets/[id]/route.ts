import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/auth'

/**
 * DELETE /api/admin/cron-secrets/{id} — revoke (soft, sets isActive=false).
 * Active scheduler hits will start failing on next call; legacy CRON_SECRET
 * env var still works as fallback.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin
  try {
    admin = await requirePlatformAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  void admin
  const { id } = await params
  await prisma.cronSecret.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
