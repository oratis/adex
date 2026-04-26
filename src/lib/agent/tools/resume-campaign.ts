import { applyCampaignStatusChange } from '@/lib/platforms/apply-status'
import type { ToolDefinition } from '../types'
import { getOwnedCampaign, requireString } from './_helpers'

type Input = { campaignId: string }

export const resumeCampaignTool: ToolDefinition<Input> = {
  name: 'resume_campaign',
  description: 'Resume a paused campaign on its platform. Reversible.',
  inputSchema: {
    type: 'object',
    properties: { campaignId: { type: 'string' } },
    required: ['campaignId'],
  },
  reversible: true,
  riskLevel: 'medium', // resuming risks re-spending budget; keep above pause
  validate(input) {
    return { campaignId: requireString(input, 'campaignId') }
  },
  async execute(ctx, input) {
    const c = await getOwnedCampaign(ctx.orgId, input.campaignId)
    if (c.desiredStatus === 'active') {
      return { ok: false, error: `Campaign ${c.id} already active` }
    }
    if (ctx.mode === 'shadow') {
      return { ok: true, output: { skipped: true, would: 'resume_campaign', campaignId: c.id } }
    }
    await applyCampaignStatusChange({ orgId: ctx.orgId, campaignId: c.id, status: 'active' })
    return { ok: true, output: { campaignId: c.id, newStatus: 'active' } }
  },
  inverse(input) {
    return { tool: 'pause_campaign', input: { campaignId: input.campaignId } }
  },
}
