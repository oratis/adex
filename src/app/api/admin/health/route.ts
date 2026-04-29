import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/auth'
import { queueDepth } from '@/lib/queue/in-process'

/**
 * GET /api/admin/health
 *
 * Internal observability dashboard data — quick "is the platform alive"
 * snapshot for platform admins. Heavy queries are bounded so this never
 * causes its own latency spike.
 */
export async function GET() {
  let admin
  try {
    admin = await requirePlatformAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  void admin

  const dbStart = Date.now()
  let dbAlive = false
  let dbLatencyMs = -1
  try {
    await prisma.$queryRaw`SELECT 1`
    dbAlive = true
    dbLatencyMs = Date.now() - dbStart
  } catch {
    dbAlive = false
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const [
    totalUsers,
    totalOrgs,
    activeAgentOrgs,
    decisionsLast24h,
    failedDecisionsLast24h,
    pendingApprovals,
    pendingWebhookDeliveries,
    abandonedWebhookDeliveries,
    auditEventsLast1h,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.agentConfig.count({ where: { enabled: true, killSwitch: false } }),
    prisma.decision.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.decision.count({ where: { status: 'failed', createdAt: { gte: oneDayAgo } } }),
    prisma.pendingApproval.count(),
    prisma.webhookDelivery.count({ where: { succeededAt: null, abandonedAt: null } }),
    prisma.webhookDelivery.count({ where: { abandonedAt: { not: null } } }),
    prisma.auditEvent.count({ where: { createdAt: { gte: oneHourAgo } } }),
  ])

  return NextResponse.json({
    db: { alive: dbAlive, latencyMs: dbLatencyMs },
    queue: { inProcessDepth: queueDepth() },
    counts: {
      users: totalUsers,
      orgs: totalOrgs,
      activeAgentOrgs,
      decisionsLast24h,
      failedDecisionsLast24h,
      pendingApprovals,
      pendingWebhookDeliveries,
      abandonedWebhookDeliveries,
      auditEventsLast1h,
    },
    timestamp: new Date().toISOString(),
  })
}
