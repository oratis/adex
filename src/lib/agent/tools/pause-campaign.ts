import { applyCampaignStatusChange } from '@/lib/platforms/apply-status'
import type { ToolDefinition } from '../types'
import { getOwnedCampaign, requireString } from './_helpers'

type Input = { campaignId: string; reason?: string }

export const pauseCampaignTool: ToolDefinition<Input> = {
  name: 'pause_campaign',
  description:
    'Pause an active campaign on its platform. Reversible: a future resume_campaign step undoes it.',
  inputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string', description: 'Local Campaign.id (cuid)' },
      reason: { type: 'string', description: 'One-sentence justification' },
    },
    required: ['campaignId'],
  },
  reversible: true,
  riskLevel: 'low',
  validate(input) {
    return { campaignId: requireString(input, 'campaignId') }
  },
  async execute(ctx, input) {
    const c = await getOwnedCampaign(ctx.orgId, input.campaignId)
    if (c.desiredStatus !== 'active') {
      return { ok: false, error: `Campaign ${c.id} is ${c.desiredStatus}; nothing to pause` }
    }
    if (ctx.mode === 'shadow') {
      return { ok: true, output: { skipped: true, would: 'pause_campaign', campaignId: c.id } }
    }
    await applyCampaignStatusChange({ orgId: ctx.orgId, campaignId: c.id, status: 'paused' })
    return { ok: true, output: { campaignId: c.id, newStatus: 'paused' } }
  },
  inverse(input) {
    return { tool: 'resume_campaign', input: { campaignId: input.campaignId } }
  },
}
