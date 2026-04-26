import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * DELETE /api/admin/invite-codes/{id} — revoke (soft).
 *
 * Used codes can also be marked revoked, but it's a no-op semantically since
 * `usedAt` already prevents re-use; the field exists for the audit trail.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin
  try {
    admin = await requirePlatformAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  const { id } = await params
  const row = await prisma.inviteCode.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.revokedAt) return NextResponse.json({ ok: true, alreadyRevoked: true })
  const updated = await prisma.inviteCode.update({
    where: { id },
    data: { revokedAt: new Date() },
  })
  const m = await prisma.orgMembership.findFirst({
    where: { userId: admin.id },
    orderBy: { createdAt: 'asc' },
  })
  if (m) {
    await logAudit({
      orgId: m.orgId,
      userId: admin.id,
      action: 'platform.disconnect',
      targetType: 'invite_code',
      targetId: id,
      metadata: { code: row.code },
    })
  }
  return NextResponse.json({ ok: true, revokedAt: updated.revokedAt })
}
