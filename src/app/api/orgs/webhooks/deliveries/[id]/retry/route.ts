import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * POST /api/orgs/webhooks/deliveries/{id}/retry
 *
 * Force-requeue an abandoned delivery: clears abandonedAt + resets
 * nextAttemptAt to now so the cron picks it up on next tick.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let org, role
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
    role = ctx.role
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Owner/admin only' }, { status: 403 })
  }
  const { id } = await params
  const delivery = await prisma.webhookDelivery.findFirst({
    where: { id, webhook: { orgId: org.id } },
  })
  if (!delivery) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.webhookDelivery.update({
    where: { id },
    data: {
      abandonedAt: null,
      nextAttemptAt: new Date(),
      attempts: 0,
      lastError: null,
    },
  })
  return NextResponse.json({ ok: true })
}
