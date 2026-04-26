/**
 * Backfill PlatformLink rows from existing Campaign.platformCampaignId values.
 *
 * Pre-P10 code wrote platform IDs directly into Campaign.platformCampaignId
 * (and AdGroup.platformAdGroupId / Ad.platformAdId). The agent runtime reads
 * the new PlatformLink table only. This script populates PlatformLink from
 * the legacy fields without touching them, so old code paths keep working
 * during the transition.
 *
 * Usage:
 *   tsx prisma/backfills/01_platform_links.ts            # report only
 *   tsx prisma/backfills/01_platform_links.ts --apply    # actually write
 *
 * Idempotent — re-running is safe; existing PlatformLink rows are upserted.
 */
import { prisma } from '../../src/lib/prisma'
import { upsertPlatformLink } from '../../src/lib/platforms/links'

const APPLY = process.argv.includes('--apply')

async function main() {
  const summary = { campaigns: 0, adGroups: 0, ads: 0, skipped: 0 }

  // Campaigns
  const campaigns = await prisma.campaign.findMany({
    where: { platformCampaignId: { not: null } },
    select: {
      id: true,
      orgId: true,
      platform: true,
      platformCampaignId: true,
    },
  })
  for (const c of campaigns) {
    if (!c.platformCampaignId) continue
    // We need an accountId — pull from the org's PlatformAuth.
    const auth = await prisma.platformAuth.findFirst({
      where: { orgId: c.orgId, platform: c.platform, isActive: true },
      select: { accountId: true },
    })
    if (!auth?.accountId) {
      summary.skipped++
      continue
    }
    if (APPLY) {
      await upsertPlatformLink({
        orgId: c.orgId,
        platform: c.platform,
        accountId: auth.accountId,
        entityType: 'campaign',
        localEntityId: c.id,
        platformEntityId: c.platformCampaignId,
        metadata: { source: 'backfill_01' },
      })
    }
    summary.campaigns++
  }

  // AdGroups (require campaign join for orgId + platform)
  const adGroups = await prisma.adGroup.findMany({
    where: { platformAdGroupId: { not: null } },
    select: {
      id: true,
      platformAdGroupId: true,
      campaign: { select: { orgId: true, platform: true } },
    },
  })
  for (const ag of adGroups) {
    if (!ag.platformAdGroupId) continue
    const auth = await prisma.platformAuth.findFirst({
      where: { orgId: ag.campaign.orgId, platform: ag.campaign.platform, isActive: true },
      select: { accountId: true },
    })
    if (!auth?.accountId) {
      summary.skipped++
      continue
    }
    if (APPLY) {
      await upsertPlatformLink({
        orgId: ag.campaign.orgId,
        platform: ag.campaign.platform,
        accountId: auth.accountId,
        entityType: 'adgroup',
        localEntityId: ag.id,
        platformEntityId: ag.platformAdGroupId,
        metadata: { source: 'backfill_01' },
      })
    }
    summary.adGroups++
  }

  // Ads
  const ads = await prisma.ad.findMany({
    where: { platformAdId: { not: null } },
    select: {
      id: true,
      platformAdId: true,
      adGroup: { select: { campaign: { select: { orgId: true, platform: true } } } },
    },
  })
  for (const a of ads) {
    if (!a.platformAdId) continue
    const c = a.adGroup.campaign
    const auth = await prisma.platformAuth.findFirst({
      where: { orgId: c.orgId, platform: c.platform, isActive: true },
      select: { accountId: true },
    })
    if (!auth?.accountId) {
      summary.skipped++
      continue
    }
    if (APPLY) {
      await upsertPlatformLink({
        orgId: c.orgId,
        platform: c.platform,
        accountId: auth.accountId,
        entityType: 'ad',
        localEntityId: a.id,
        platformEntityId: a.platformAdId,
        metadata: { source: 'backfill_01' },
      })
    }
    summary.ads++
  }

  console.log(`[backfill_01] ${APPLY ? 'WROTE' : 'WOULD WRITE'}`, summary)
  if (!APPLY) console.log('Re-run with --apply to commit.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
