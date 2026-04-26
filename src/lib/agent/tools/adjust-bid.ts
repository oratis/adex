import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { getOwnedCampaign, requireNumber, requireString } from './_helpers'

type Input = {
  campaignId: string
  newBidUsd: number
  previousBidUsd?: number
}

/**
 * adjust_bid — set a new max bid on a campaign.
 *
 * Local-only persistence as PlatformLink.metadata until the platform-side
 * `updateCampaignBid` adapter call lands. The intent is recorded so a human
 * (or the post-P16 sync worker) can apply it.
 */
export const adjustBidTool: ToolDefinition<Input> = {
  name: 'adjust_bid',
  description:
    'Set a new max bid (USD) on a campaign. Records intent on PlatformLink.metadata; platform-side push is pending the high-risk-bidding adapter work.',
  inputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      newBidUsd: { type: 'number', minimum: 0 },
      previousBidUsd: { type: 'number' },
    },
    required: ['campaignId', 'newBidUsd'],
  },
  reversible: true,
  riskLevel: 'high',
  validate(input) {
    const out: Input = {
      campaignId: requireString(input, 'campaignId'),
      newBidUsd: requireNumber(input, 'newBidUsd'),
    }
    if (input && typeof input === 'object') {
      const prev = (input as Record<string, unknown>).previousBidUsd
      if (typeof prev === 'number' && Number.isFinite(prev)) out.previousBidUsd = prev
    }
    if (out.newBidUsd <= 0) throw new Error('newBidUsd must be > 0')
    return out
  },
  async execute(ctx, input) {
    const c = await getOwnedCampaign(ctx.orgId, input.campaignId)
    const link = await prisma.platformLink.findFirst({
      where: { orgId: ctx.orgId, entityType: 'campaign', localEntityId: c.id, status: 'active' },
    })
    if (!link) return { ok: false, error: `No PlatformLink for campaign ${c.id}` }
    if (ctx.mode === 'shadow') {
      return {
        ok: true,
        output: { skipped: true, would: 'adjust_bid', campaignId: c.id, newBidUsd: input.newBidUsd },
      }
    }
    const meta = (() => {
      try {
        return link.metadata ? (JSON.parse(link.metadata) as Record<string, unknown>) : {}
      } catch {
        return {}
      }
    })()
    meta.maxBidUsd = input.newBidUsd
    meta.maxBidUsdSetAt = new Date().toISOString()
    if (input.previousBidUsd !== undefined) meta.previousBidUsd = input.previousBidUsd
    await prisma.platformLink.update({
      where: { id: link.id },
      data: { metadata: JSON.stringify(meta) },
    })
    return {
      ok: true,
      output: { campaignId: c.id, newBidUsd: input.newBidUsd, persistedTo: 'PlatformLink.metadata' },
      platformLinkId: link.id,
    }
  },
  inverse(input) {
    if (typeof input.previousBidUsd !== 'number') return null
    return {
      tool: 'adjust_bid',
      input: { campaignId: input.campaignId, newBidUsd: input.previousBidUsd },
    }
  },
}
