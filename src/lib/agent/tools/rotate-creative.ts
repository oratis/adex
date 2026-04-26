import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { requireString } from './_helpers'

type Input = { adId: string; newCreativeId: string }

/**
 * rotate_creative — swap an ad's local creative reference. Pushing the new
 * asset to the platform requires the Phase-15 Creative Pipeline; for now we
 * record intent locally and flag the ad as needing platform sync.
 */
export const rotateCreativeTool: ToolDefinition<Input> = {
  name: 'rotate_creative',
  description: "Replace an ad's creative with another from the org's library.",
  inputSchema: {
    type: 'object',
    properties: { adId: { type: 'string' }, newCreativeId: { type: 'string' } },
    required: ['adId', 'newCreativeId'],
  },
  reversible: true,
  riskLevel: 'medium',
  validate(input) {
    return {
      adId: requireString(input, 'adId'),
      newCreativeId: requireString(input, 'newCreativeId'),
    }
  },
  async execute(ctx, input) {
    const ad = await prisma.ad.findFirst({
      where: { id: input.adId, adGroup: { campaign: { orgId: ctx.orgId } } },
    })
    if (!ad) return { ok: false, error: `Ad ${input.adId} not found in org` }
    const creative = await prisma.creative.findFirst({
      where: { id: input.newCreativeId, orgId: ctx.orgId },
    })
    if (!creative)
      return { ok: false, error: `Creative ${input.newCreativeId} not found in org` }

    if (ctx.mode === 'shadow') {
      return {
        ok: true,
        output: { skipped: true, would: 'rotate_creative', adId: ad.id, newCreativeId: creative.id },
      }
    }
    const previousCreativeId = ad.creativeId
    await prisma.ad.update({
      where: { id: ad.id },
      data: { creativeId: creative.id, status: 'draft' /* needs re-push */ },
    })
    return {
      ok: true,
      output: { adId: ad.id, previousCreativeId, newCreativeId: creative.id },
    }
  },
}
