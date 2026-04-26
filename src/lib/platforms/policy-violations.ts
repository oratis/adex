import { prisma } from '@/lib/prisma'
import { fireWebhook } from '@/lib/webhooks'
import { logAudit } from '@/lib/audit'

/**
 * Per docs/agent/09-roadmap.md §Phase 15 work item 7: when a platform reports
 * an ad as rejected for policy reasons we must surface it (audit + webhook +
 * Ad.platformPolicyStatus). Sync workers and adapters call into this single
 * helper so the surface is consistent.
 *
 * Idempotent within a status — calling twice with the same status is a no-op
 * for the Ad row and only fires the webhook on the first transition into a
 * rejected state.
 */
export async function recordAdPolicyStatus(opts: {
  orgId: string
  platformAdId: string
  status: 'approved' | 'pending_review' | 'rejected'
  reason?: string
}): Promise<{ updated: number; flagged: boolean }> {
  const ads = await prisma.ad.findMany({
    where: {
      platformAdId: opts.platformAdId,
      adGroup: { campaign: { orgId: opts.orgId } },
    },
    include: { adGroup: { include: { campaign: true } } },
  })
  if (ads.length === 0) return { updated: 0, flagged: false }

  let flagged = false
  for (const ad of ads) {
    const wasRejected = ad.platformPolicyStatus === 'rejected'
    await prisma.ad.update({
      where: { id: ad.id },
      data: {
        platformPolicyStatus: opts.status,
        platformPolicyNote: opts.reason || null,
      },
    })
    if (opts.status === 'rejected' && !wasRejected) {
      flagged = true
      fireWebhook({
        orgId: opts.orgId,
        event: 'ad.policy_rejected',
        data: {
          adId: ad.id,
          campaignId: ad.adGroup.campaign.id,
          platformAdId: ad.platformAdId,
          reason: opts.reason || 'no reason provided by platform',
        },
      }).catch(() => {})
      logAudit({
        orgId: opts.orgId,
        action: 'advisor.apply',
        targetType: 'ad',
        targetId: ad.id,
        metadata: {
          source: 'platform_policy',
          reason: opts.reason,
          campaignId: ad.adGroup.campaign.id,
        },
      }).catch(() => {})
    }
  }
  return { updated: ads.length, flagged }
}
