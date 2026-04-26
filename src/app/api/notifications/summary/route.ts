import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg, isPlatformAdmin } from '@/lib/auth'

/**
 * GET /api/notifications/summary
 *
 * Compact counts for the in-app bell. Polled by the bell component every
 * ~60s. Cheap aggregate queries only.
 */
export async function GET() {
  let user, org
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [pendingApprovals, expiringApprovals, driftedCampaigns, pendingCreatives, abandonedDeliveries, freshFailures] =
    await Promise.all([
      prisma.pendingApproval.count({
        where: { orgId: org.id, decision: { status: 'pending' } },
      }),
      prisma.pendingApproval.count({
        where: {
          orgId: org.id,
          decision: { status: 'pending' },
          expiresAt: { lt: new Date(now.getTime() + 12 * 60 * 60 * 1000) },
        },
      }),
      prisma.campaign.count({
        where: {
          orgId: org.id,
          managedByAgent: true,
          syncError: { not: null },
        },
      }),
      prisma.creative.count({
        where: { orgId: org.id, reviewStatus: 'pending' },
      }),
      prisma.webhookDelivery.count({
        where: { webhook: { orgId: org.id }, abandonedAt: { not: null, gte: oneDayAgo } },
      }),
      prisma.decision.count({
        where: { orgId: org.id, status: 'failed', createdAt: { gte: oneDayAgo } },
      }),
    ])

  // Platform-admin extras
  let platformAdminInvitesUnused = 0
  if (isPlatformAdmin(user)) {
    platformAdminInvitesUnused = await prisma.inviteCode.count({
      where: { usedAt: null, revokedAt: null },
    })
  }

  return NextResponse.json({
    pendingApprovals,
    expiringApprovals,
    driftedCampaigns,
    pendingCreatives,
    abandonedDeliveries,
    freshFailures,
    platformAdminInvitesUnused,
    total: pendingApprovals + driftedCampaigns + pendingCreatives + abandonedDeliveries + freshFailures,
  })
}
