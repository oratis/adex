import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { requireString } from './_helpers'

type Input = { adGroupId: string; reason?: string }

/**
 * pause_ad_group — set local AdGroup.status='paused'. Push-to-platform via
 * adapter is not yet wired (no PlatformAdapter.pauseAdGroup method); the
 * agent records intent and the legacy reconciler will catch up.
 */
export const pauseAdGroupTool: ToolDefinition<Input> = {
  name: 'pause_ad_group',
  description:
    'Pause a specific ad group inside a campaign. Records intent locally and updates AdGroup.status.',
  inputSchema: {
    type: 'object',
    properties: { adGroupId: { type: 'string' }, reason: { type: 'string' } },
    required: ['adGroupId'],
  },
  reversible: true,
  riskLevel: 'low',
  validate(input) {
    return { adGroupId: requireString(input, 'adGroupId') }
  },
  async execute(ctx, input) {
    const ag = await prisma.adGroup.findFirst({
      where: { id: input.adGroupId, campaign: { orgId: ctx.orgId } },
    })
    if (!ag) return { ok: false, error: `AdGroup ${input.adGroupId} not found in org` }
    if (ctx.mode === 'shadow') {
      return { ok: true, output: { skipped: true, would: 'pause_ad_group', adGroupId: ag.id } }
    }
    await prisma.adGroup.update({ where: { id: ag.id }, data: { status: 'paused' } })
    return { ok: true, output: { adGroupId: ag.id, newStatus: 'paused' } }
  },
}
