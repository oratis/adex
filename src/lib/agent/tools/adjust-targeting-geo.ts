import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { getOwnedCampaign, requireString } from './_helpers'

type Input = {
  campaignId: string
  countriesToAdd?: string[]
  countriesToRemove?: string[]
  previousCountries?: string[]
}

/**
 * adjust_targeting_geo — change geo targeting for a campaign.
 * Updates Campaign.targetCountries (JSON array) only; platform-side push
 * lands when the targeting-update adapter method exists.
 */
export const adjustTargetingGeoTool: ToolDefinition<Input> = {
  name: 'adjust_targeting_geo',
  description:
    'Add or remove ISO-3166 country codes from a campaign\'s geo targeting. Provide previousCountries (the full prior list) so the change is exactly reversible.',
  inputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      countriesToAdd: { type: 'array', items: { type: 'string' } },
      countriesToRemove: { type: 'array', items: { type: 'string' } },
      previousCountries: { type: 'array', items: { type: 'string' } },
    },
    required: ['campaignId'],
  },
  reversible: true,
  riskLevel: 'high',
  validate(input) {
    const obj = (input || {}) as Record<string, unknown>
    const out: Input = { campaignId: requireString(input, 'campaignId') }
    const validateArr = (v: unknown, key: string): string[] | undefined => {
      if (v === undefined) return undefined
      if (!Array.isArray(v)) throw new Error(`${key} must be string[]`)
      return v.map((c, i) => {
        if (typeof c !== 'string') throw new Error(`${key}[${i}] must be string`)
        return c.trim().toUpperCase()
      })
    }
    out.countriesToAdd = validateArr(obj.countriesToAdd, 'countriesToAdd')
    out.countriesToRemove = validateArr(obj.countriesToRemove, 'countriesToRemove')
    out.previousCountries = validateArr(obj.previousCountries, 'previousCountries')
    if (
      (!out.countriesToAdd || out.countriesToAdd.length === 0) &&
      (!out.countriesToRemove || out.countriesToRemove.length === 0)
    ) {
      throw new Error('At least one of countriesToAdd / countriesToRemove must be non-empty')
    }
    return out
  },
  async execute(ctx, input) {
    const c = await getOwnedCampaign(ctx.orgId, input.campaignId)
    const current: string[] = c.targetCountries
      ? (() => {
          try {
            const v = JSON.parse(c.targetCountries) as unknown
            return Array.isArray(v) ? (v as string[]) : []
          } catch {
            return []
          }
        })()
      : []
    const set = new Set(current)
    for (const code of input.countriesToAdd || []) set.add(code)
    for (const code of input.countriesToRemove || []) set.delete(code)
    const next = Array.from(set).sort()

    if (ctx.mode === 'shadow') {
      return {
        ok: true,
        output: { skipped: true, would: 'adjust_targeting_geo', from: current, to: next },
      }
    }

    await prisma.campaign.update({
      where: { id: c.id },
      data: { targetCountries: JSON.stringify(next) },
    })
    return {
      ok: true,
      output: {
        campaignId: c.id,
        previousCountries: current,
        newCountries: next,
        added: input.countriesToAdd || [],
        removed: input.countriesToRemove || [],
      },
    }
  },
  inverse(input) {
    if (!Array.isArray(input.previousCountries)) return null
    return {
      tool: 'adjust_targeting_geo',
      input: {
        campaignId: input.campaignId,
        countriesToAdd: input.previousCountries.filter(
          (c) => (input.countriesToRemove || []).includes(c)
        ),
        countriesToRemove: (input.countriesToAdd || []).filter(
          (c) => !input.previousCountries!.includes(c)
        ),
        previousCountries: undefined,
      },
    }
  },
}
