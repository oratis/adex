import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { WebhookDeliveriesClient } from './client'

export const dynamic = 'force-dynamic'

const VALID = new Set(['pending', 'abandoned', 'succeeded'])

export default async function WebhookDeliveriesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')
  const sp = await props.searchParams
  const statusParam =
    typeof sp.status === 'string' && VALID.has(sp.status) ? sp.status : 'pending'

  const where: Record<string, unknown> = { webhook: { orgId: ctx.org.id } }
  if (statusParam === 'pending') {
    where.succeededAt = null
    where.abandonedAt = null
  } else if (statusParam === 'abandoned') {
    where.abandonedAt = { not: null }
  } else if (statusParam === 'succeeded') {
    where.succeededAt = { not: null }
  }
  const deliveries = await prisma.webhookDelivery.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { webhook: { select: { id: true, url: true } } },
  })

  return (
    <WebhookDeliveriesClient
      role={ctx.role}
      filterStatus={statusParam}
      deliveries={deliveries.map((d) => ({
        id: d.id,
        webhookUrl: d.webhook.url,
        event: d.event,
        attempts: d.attempts,
        maxAttempts: d.maxAttempts,
        nextAttemptAt: d.nextAttemptAt.toISOString(),
        succeededAt: d.succeededAt?.toISOString() || null,
        abandonedAt: d.abandonedAt?.toISOString() || null,
        lastStatusCode: d.lastStatusCode,
        lastError: d.lastError,
        createdAt: d.createdAt.toISOString(),
      }))}
    />
  )
}
