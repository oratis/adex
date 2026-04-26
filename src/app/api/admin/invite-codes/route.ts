import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { generateInviteCode } from '@/lib/invite-codes'

/**
 * GET  /api/admin/invite-codes — list all invite codes
 *   Query: ?status=unused|used|expired|revoked|all (default: all)
 *
 * POST /api/admin/invite-codes — generate a new code
 *   Body: { note?: string; expiresInDays?: number; count?: number }
 *
 * Both endpoints require platform-admin (User.isPlatformAdmin or env
 * PLATFORM_ADMIN_EMAILS); regular org owners do NOT qualify.
 */
export async function GET(req: NextRequest) {
  let admin
  try {
    admin = await requirePlatformAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  void admin

  const url = new URL(req.url)
  const status = url.searchParams.get('status') || 'all'
  const where: Record<string, unknown> = {}
  if (status === 'unused') {
    where.usedAt = null
    where.revokedAt = null
  } else if (status === 'used') {
    where.usedAt = { not: null }
  } else if (status === 'revoked') {
    where.revokedAt = { not: null }
  } else if (status === 'expired') {
    where.usedAt = null
    where.expiresAt = { not: null, lt: new Date() }
  }

  const rows = await prisma.inviteCode.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      creator: { select: { email: true, name: true } },
      usedBy: { select: { email: true, name: true } },
    },
  })
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  let admin
  try {
    admin = await requirePlatformAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }

  const body = await req.json().catch(() => ({}))
  const note = typeof body.note === 'string' ? body.note.slice(0, 200) : null
  const batchLabel = typeof body.batchLabel === 'string' ? body.batchLabel.slice(0, 100) : null
  const count = Math.min(Math.max(Number(body.count) || 1, 1), 50)
  const expiresInDays = Number(body.expiresInDays)
  const expiresAt =
    Number.isFinite(expiresInDays) && expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null

  const created = []
  for (let i = 0; i < count; i++) {
    // Retry on rare collision (~zero probability with 12-char Crockford-ish alphabet)
    let attempt = 0
    while (attempt < 3) {
      try {
        const row = await prisma.inviteCode.create({
          data: {
            code: generateInviteCode(),
            createdBy: admin.id,
            note,
            batchLabel,
            expiresAt,
          },
        })
        created.push(row)
        break
      } catch (err) {
        attempt++
        if (attempt >= 3) throw err
      }
    }
  }

  // Audit log into the admin's personal org (best effort — find first membership)
  const m = await prisma.orgMembership.findFirst({
    where: { userId: admin.id },
    orderBy: { createdAt: 'asc' },
  })
  if (m) {
    await logAudit({
      orgId: m.orgId,
      userId: admin.id,
      action: 'platform.connect', // closest existing AuditAction; refine when we add invite.* actions
      targetType: 'invite_code',
      metadata: { count: created.length, expiresInDays: expiresInDays || null, note },
      req,
    })
  }
  return NextResponse.json({ created })
}
