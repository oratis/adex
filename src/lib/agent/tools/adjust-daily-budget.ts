import { prisma } from '@/lib/prisma'
import { getAdapter, isAdaptablePlatform } from '@/lib/platforms/registry'
import { findCampaignLink } from '@/lib/platforms/links'
import { PlatformError } from '@/lib/platforms/adapter'
import type { ToolDefinition } from '../types'
import { getOwnedCampaign, requireNumber, requireString } from './_helpers'

type Input = { campaignId: string; newDailyBudget: number; previousDailyBudget?: number }

export const adjustDailyBudgetTool: ToolDefinition<Input> = {
  name: 'adjust_daily_budget',
  description:
    'Set a new daily budget on a campaign. Include previousDailyBudget so we can roll back exactly.',
  inputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      newDailyBudget: { type: 'number', minimum: 0 },
      previousDailyBudget: { type: 'number' },
    },
    required: ['campaignId', 'newDailyBudget'],
  },
  reversible: true,
  riskLevel: 'medium',
  validate(input) {
    const out: Input = {
      campaignId: requireString(input, 'campaignId'),
      newDailyBudget: requireNumber(input, 'newDailyBudget'),
    }
    if (input && typeof input === 'object') {
      const prev = (input as Record<string, unknown>).previousDailyBudget
      if (typeof prev === 'number' && Number.isFinite(prev)) out.previousDailyBudget = prev
    }
    if (out.newDailyBudget <= 0) throw new Error('newDailyBudget must be > 0')
    return out
  },
  async execute(ctx, input) {
    const c = await getOwnedCampaign(ctx.orgId, input.campaignId)
    if (!isAdaptablePlatform(c.platform)) {
      return { ok: false, error: `Platform ${c.platform} is not adaptable for budget changes` }
    }
    const link = await findCampaignLink(ctx.orgId, c.id)
    const platformCampaignId = link?.platformEntityId || c.platformCampaignId
    if (!platformCampaignId) {
      return { ok: false, error: `No platform link for campaign ${c.id}` }
    }
    if (ctx.mode === 'shadow') {
      return {
        ok: true,
        output: {
          skipped: true,
          would: 'adjust_daily_budget',
          campaignId: c.id,
          newDailyBudget: input.newDailyBudget,
        },
      }
    }
    const auth = await prisma.platformAuth.findFirst({
      where: { orgId: ctx.orgId, platform: c.platform, isActive: true },
    })
    if (!auth) return { ok: false, error: `No ${c.platform} auth` }
    try {
      const adapter = getAdapter(c.platform, auth)
      await adapter.updateCampaignBudget(platformCampaignId, input.newDailyBudget)
    } catch (err) {
      if (err instanceof PlatformError) return { ok: false, error: err.message, code: err.code }
      throw err
    }
    return {
      ok: true,
      output: { campaignId: c.id, newDailyBudget: input.newDailyBudget },
      platformLinkId: link?.id,
    }
  },
  inverse(input) {
    if (typeof input.previousDailyBudget !== 'number') return null
    return {
      tool: 'adjust_daily_budget',
      input: {
        campaignId: input.campaignId,
        newDailyBudget: input.previousDailyBudget,
      },
    }
  },
}
