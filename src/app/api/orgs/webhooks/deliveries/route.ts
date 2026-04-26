import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

/**
 * GET /api/orgs/webhooks/deliveries?status=pending|abandoned|succeeded
 *
 * Returns delivery rows for the org's webhooks. Bounded at 100 rows for
 * UI sanity.
 */
const STATUSES = ['pending', 'abandoned', 'succeeded'] as const

export async function GET(req: NextRequest) {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const status = url.searchParams.get('status') as typeof STATUSES[number] | null
  const where: Record<string, unknown> = { webhook: { orgId: org.id } }
  if (status === 'pending') {
    where.succeededAt = null
    where.abandonedAt = null
  } else if (status === 'abandoned') {
    where.abandonedAt = { not: null }
  } else if (status === 'succeeded') {
    where.succeededAt = { not: null }
  }
  const deliveries = await prisma.webhookDelivery.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { webhook: { select: { id: true, url: true } } },
  })
  return NextResponse.json(deliveries)
}
