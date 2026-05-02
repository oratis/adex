import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { getOwnedCampaign, requireString } from './_helpers'

type Input = {
  campaignId: string
  ageMin?: number
  ageMax?: number
  gender?: 'all' | 'male' | 'female'
  previous?: { ageMin: number | null; ageMax: number | null; gender: string | null }
}

/**
 * adjust_targeting_demo — change age / gender targeting on a campaign.
 *
 * Local-only persistence (Campaign columns); platform-side push lands with
 * the broader targeting-update adapter work. Keeps the previous values so
 * the rollback inverse is exact.
 */
export const adjustTargetingDemoTool: ToolDefinition<Input> = {
  name: 'adjust_targeting_demo',
  description:
    "Change campaign demographic targeting (ageMin / ageMax / gender). Provide `previous` so the change can be rolled back exactly.",
  inputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      ageMin: { type: 'number', minimum: 13, maximum: 120 },
      ageMax: { type: 'number', minimum: 13, maximum: 120 },
      gender: { type: 'string', enum: ['all', 'male', 'female'] },
      previous: {
        type: 'object',
        properties: {
          ageMin: { type: ['number', 'null'] },
          ageMax: { type: ['number', 'null'] },
          gender: { type: ['string', 'null'] },
        },
      },
    },
    required: ['campaignId'],
  },
  reversible: true,
  requiresPriorState: true, // needs previous bag for clean rollback
  dependsOnPriorSuccess: true,
  riskLevel: 'high',
  validate(input) {
    const obj = (input || {}) as Record<string, unknown>
    const out: Input = { campaignId: requireString(input, 'campaignId') }
    if (typeof obj.ageMin === 'number') out.ageMin = obj.ageMin
    if (typeof obj.ageMax === 'number') out.ageMax = obj.ageMax
    if (out.ageMin !== undefined && out.ageMax !== undefined && out.ageMin > out.ageMax)
      throw new Error('ageMin > ageMax')
    if (obj.gender === 'all' || obj.gender === 'male' || obj.gender === 'female')
      out.gender = obj.gender
    else if (obj.gender !== undefined) throw new Error('gender must be all|male|female')
    if (out.ageMin === undefined && out.ageMax === undefined && out.gender === undefined)
      throw new Error('No demographic field provided')
    if (obj.previous && typeof obj.previous === 'object') {
      const p = obj.previous as Record<string, unknown>
      out.previous = {
        ageMin: typeof p.ageMin === 'number' ? p.ageMin : null,
        ageMax: typeof p.ageMax === 'number' ? p.ageMax : null,
        gender: typeof p.gender === 'string' ? p.gender : null,
      }
    }
    return out
  },
  async execute(ctx, input) {
    const c = await getOwnedCampaign(ctx.orgId, input.campaignId)
    if (ctx.mode === 'shadow') {
      return {
        ok: true,
        output: {
          skipped: true,
          would: 'adjust_targeting_demo',
          campaignId: c.id,
          changes: { ageMin: input.ageMin, ageMax: input.ageMax, gender: input.gender },
        },
      }
    }
    const data: Record<string, unknown> = {}
    if (input.ageMin !== undefined) data.ageMin = input.ageMin
    if (input.ageMax !== undefined) data.ageMax = input.ageMax
    if (input.gender !== undefined) data.gender = input.gender
    await prisma.campaign.update({ where: { id: c.id }, data })
    return {
      ok: true,
      output: {
        campaignId: c.id,
        applied: data,
        previous: { ageMin: c.ageMin, ageMax: c.ageMax, gender: c.gender },
      },
    }
  },
  inverse(input) {
    if (!input.previous) return null
    return {
      tool: 'adjust_targeting_demo',
      input: {
        campaignId: input.campaignId,
        ageMin: input.previous.ageMin ?? undefined,
        ageMax: input.previous.ageMax ?? undefined,
        gender: (input.previous.gender as 'all' | 'male' | 'female' | null | undefined) || undefined,
      },
    }
  },
}
