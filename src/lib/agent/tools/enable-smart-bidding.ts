import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { getOwnedCampaign, requireString } from './_helpers'

type Input = {
  campaignId: string
  strategy: 'maximize_conversions' | 'target_cpa' | 'target_roas'
  targetValue?: number
}

/**
 * enable_smart_bidding — switch a campaign to a smart-bidding strategy.
 * Local-only persistence on PlatformLink.metadata (see adjust_bid for the
 * same rationale).
 */
export const enableSmartBiddingTool: ToolDefinition<Input> = {
  name: 'enable_smart_bidding',
  description:
    "Switch a campaign to a smart-bidding strategy (maximize_conversions | target_cpa | target_roas). target_cpa needs targetValue in USD; target_roas needs targetValue as a multiplier (e.g. 3 = 3x ROAS). Records intent on PlatformLink.metadata.",
  inputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      strategy: { type: 'string', enum: ['maximize_conversions', 'target_cpa', 'target_roas'] },
      targetValue: { type: 'number', minimum: 0 },
    },
    required: ['campaignId', 'strategy'],
  },
  reversible: false, // smart bidding rolls back via a new explicit decision
  riskLevel: 'high',
  validate(input) {
    const obj = (input || {}) as Record<string, unknown>
    const strategy = obj.strategy
    if (
      strategy !== 'maximize_conversions' &&
      strategy !== 'target_cpa' &&
      strategy !== 'target_roas'
    )
      throw new Error('strategy must be one of maximize_conversions | target_cpa | target_roas')
    const out: Input = {
      campaignId: requireString(input, 'campaignId'),
      strategy,
    }
    if ((strategy === 'target_cpa' || strategy === 'target_roas') && typeof obj.targetValue !== 'number')
      throw new Error(`${strategy} requires targetValue`)
    if (typeof obj.targetValue === 'number') out.targetValue = obj.targetValue
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
        output: { skipped: true, would: 'enable_smart_bidding', campaignId: c.id, strategy: input.strategy },
      }
    }
    const meta = (() => {
      try {
        return link.metadata ? (JSON.parse(link.metadata) as Record<string, unknown>) : {}
      } catch {
        return {}
      }
    })()
    meta.bidStrategy = input.strategy
    if (input.targetValue !== undefined) meta.bidStrategyTargetValue = input.targetValue
    meta.bidStrategySetAt = new Date().toISOString()
    await prisma.platformLink.update({
      where: { id: link.id },
      data: { metadata: JSON.stringify(meta) },
    })
    return {
      ok: true,
      output: { campaignId: c.id, strategy: input.strategy, targetValue: input.targetValue },
      platformLinkId: link.id,
    }
  },
}
