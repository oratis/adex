import { prisma } from '@/lib/prisma'
import { getAdapter, isAdaptablePlatform } from '@/lib/platforms/registry'
import { PlatformError } from '@/lib/platforms/adapter'
import type { ToolDefinition } from '../types'
import { requireString } from './_helpers'

type Input = { adId: string; reason?: string }

export const pauseAdTool: ToolDefinition<Input> = {
  name: 'pause_ad',
  description: 'Pause a single ad on its platform.',
  inputSchema: {
    type: 'object',
    properties: { adId: { type: 'string' }, reason: { type: 'string' } },
    required: ['adId'],
  },
  reversible: true,
  riskLevel: 'low',
  validate(input) {
    return { adId: requireString(input, 'adId') }
  },
  async execute(ctx, input) {
    const ad = await prisma.ad.findFirst({
      where: { id: input.adId, adGroup: { campaign: { orgId: ctx.orgId } } },
      include: { adGroup: { include: { campaign: true } } },
    })
    if (!ad) return { ok: false, error: `Ad ${input.adId} not found in org` }

    const platform = ad.adGroup.campaign.platform
    const platformAdId = ad.platformAdId

    if (ctx.mode === 'shadow') {
      return { ok: true, output: { skipped: true, would: 'pause_ad', adId: ad.id } }
    }

    if (platformAdId && isAdaptablePlatform(platform)) {
      const auth = await prisma.platformAuth.findFirst({
        where: { orgId: ctx.orgId, platform, isActive: true },
      })
      if (auth) {
        try {
          const adapter = getAdapter(platform, auth)
          await adapter.pauseAd(platformAdId)
        } catch (err) {
          if (err instanceof PlatformError && err.code !== 'invalid_argument') {
            return { ok: false, error: err.message, code: err.code }
          }
          // Fall through to local-only update if adapter doesn't implement.
        }
      }
    }

    await prisma.ad.update({ where: { id: ad.id }, data: { status: 'paused' } })
    return { ok: true, output: { adId: ad.id, newStatus: 'paused' } }
  },
}
