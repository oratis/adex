import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/cron/agent-expire
 *
 * Sweep PendingApproval rows past expiresAt; auto-reject the underlying
 * Decision per the 72h policy (see 07-safety.md). Run once an hour.
 */
function checkCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided =
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer /i, '')
  return provided === secret
}

export async function POST(req: NextRequest) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = new Date()
  const expired = await prisma.pendingApproval.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true, decisionId: true },
  })
  if (expired.length === 0) {
    return NextResponse.json({ ok: true, expired: 0 })
  }
  await prisma.$transaction([
    prisma.decision.updateMany({
      where: { id: { in: expired.map((e) => e.decisionId) } },
      data: { status: 'rejected', rejectedReason: 'expired (72h)' },
    }),
    prisma.pendingApproval.deleteMany({ where: { id: { in: expired.map((e) => e.id) } } }),
  ])
  return NextResponse.json({ ok: true, expired: expired.length })
}
