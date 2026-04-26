import { prisma } from '@/lib/prisma'
import { getAdapter, isAdaptablePlatform } from './registry'
import { findCampaignLink } from './links'
import { PlatformError, type DesiredStatus } from './adapter'

/**
 * applyCampaignStatusChange — push a desired status to the platform AND
 * persist the result locally. This is the single chokepoint that the launch
 * route, advisor.apply, agent runtime, and any future automation must go
 * through. It guarantees:
 *   1. Local desiredStatus is updated to the new value.
 *   2. The platform API is actually called (adapters required).
 *   3. syncedStatus / syncedAt / syncError reflect what the platform said.
 *   4. status mirror keeps the legacy field in sync for old UI code.
 *
 * Returns the updated Campaign or throws if no adapter / no link.
 */
export async function applyCampaignStatusChange(opts: {
  orgId: string
  campaignId: string
  status: DesiredStatus
}) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: opts.campaignId, orgId: opts.orgId },
  })
  if (!campaign) throw new Error('Campaign not found')

  if (!isAdaptablePlatform(campaign.platform)) {
    // Legacy / unsupported platform — update local only, no API call.
    return prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        desiredStatus: opts.status,
        status: opts.status === 'archived' ? 'completed' : opts.status,
      },
    })
  }

  const link = await findCampaignLink(opts.orgId, campaign.id)
  const platformCampaignId = link?.platformEntityId || campaign.platformCampaignId
  if (!platformCampaignId) {
    // Local-only campaign (never launched) — only flip desiredStatus.
    return prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        desiredStatus: opts.status,
        status: opts.status === 'archived' ? 'completed' : opts.status,
      },
    })
  }

  const auth = await prisma.platformAuth.findFirst({
    where: { orgId: opts.orgId, platform: campaign.platform, isActive: true },
  })
  if (!auth) throw new Error(`No ${campaign.platform} authorization found`)

  const adapter = getAdapter(campaign.platform, auth)
  try {
    await adapter.updateCampaignStatus(platformCampaignId, opts.status)
  } catch (err) {
    const msg = err instanceof PlatformError ? `[${err.code}] ${err.message}` : String(err)
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { syncError: msg.slice(0, 500), syncedAt: new Date() },
    })
    throw err
  }

  return prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      desiredStatus: opts.status,
      status: opts.status === 'archived' ? 'completed' : opts.status,
      syncedStatus: opts.status,
      syncedAt: new Date(),
      syncError: null,
    },
  })
}
