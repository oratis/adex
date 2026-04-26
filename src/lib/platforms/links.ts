import { prisma } from '@/lib/prisma'
import type { EntityType } from './adapter'

/**
 * PlatformLink — single source of truth for "local entity ↔ platform entity"
 * mapping. New code must always upsert here when creating a platform-side
 * resource so the Agent runtime can resolve either direction reliably.
 */
export async function upsertPlatformLink(opts: {
  orgId: string
  platform: string
  accountId: string
  entityType: EntityType
  localEntityId: string
  platformEntityId: string
  metadata?: Record<string, unknown>
}) {
  const { orgId, platform, accountId, entityType, localEntityId, platformEntityId, metadata } = opts
  return prisma.platformLink.upsert({
    where: {
      platform_accountId_platformEntityId_entityType: {
        platform,
        accountId,
        platformEntityId,
        entityType,
      },
    },
    update: {
      localEntityId,
      lastSyncedAt: new Date(),
      metadata: metadata ? JSON.stringify(metadata) : undefined,
      status: 'active',
    },
    create: {
      orgId,
      platform,
      accountId,
      entityType,
      localEntityId,
      platformEntityId,
      metadata: metadata ? JSON.stringify(metadata) : null,
      status: 'active',
      lastSyncedAt: new Date(),
    },
  })
}

export async function findCampaignLink(orgId: string, localCampaignId: string) {
  return prisma.platformLink.findFirst({
    where: {
      orgId,
      entityType: 'campaign',
      localEntityId: localCampaignId,
      status: 'active',
    },
  })
}

export async function findCampaignLinkByPlatform(
  orgId: string,
  platform: string,
  platformCampaignId: string
) {
  return prisma.platformLink.findFirst({
    where: {
      orgId,
      platform,
      entityType: 'campaign',
      platformEntityId: platformCampaignId,
    },
  })
}

export async function markLinkOrphan(id: string) {
  return prisma.platformLink.update({ where: { id }, data: { status: 'orphan' } })
}
