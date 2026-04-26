import { prisma } from '@/lib/prisma'
import { getAdapter, isAdaptablePlatform } from '@/lib/platforms/registry'
import { upsertPlatformLink } from '@/lib/platforms/links'
import { PlatformError } from '@/lib/platforms/adapter'
import type { ToolDefinition } from '../types'
import { requireString } from './_helpers'

type Arm = { name: string; adLinkId: string; trafficShare: number }
type Input = {
  campaignLinkId: string
  hypothesis: string
  primaryMetric: 'ctr' | 'cvr'
  durationHours?: number
  minSampleSize?: number
  arms: Arm[]
  // P15 — when provided, the tool clones this ad-group into the campaign and
  // uses the new link as one of the arms. The other arm comes from the
  // sourceAdGroupLinkId itself, giving a true 50/50 control vs variant split.
  cloneFromAdGroupLinkId?: string
}

/**
 * start_experiment — kick off a 2-arm A/B against an existing platform
 * campaign.
 *
 * Two modes:
 *
 *   1. **arms supplied**: caller already has 2 PlatformLinks (entityType=ad
 *      or entityType=adgroup) and passes them as `arms`. The tool just
 *      records the experiment.
 *
 *   2. **cloneFromAdGroupLinkId supplied**: the tool clones that ad group
 *      via adapter.createAdGroup into the same campaign, gets a new
 *      PlatformLink, then records both links as the experiment's arms with
 *      50/50 traffic. Realises P15 work item 4: "复制 ad group + 50/50 流量".
 */
export const startExperimentTool: ToolDefinition<Input> = {
  name: 'start_experiment',
  description:
    'Start a 2-arm experiment on a campaign. Either pass `arms: [{name, adLinkId, trafficShare}, ...]` (must sum to 1.0) OR pass `cloneFromAdGroupLinkId` and the tool will clone that ad group + assign 50/50 split. The conclude_experiment tool runs the significance test.',
  inputSchema: {
    type: 'object',
    properties: {
      campaignLinkId: { type: 'string' },
      hypothesis: { type: 'string', minLength: 10 },
      primaryMetric: { type: 'string', enum: ['ctr', 'cvr'] },
      durationHours: { type: 'number', minimum: 24 },
      minSampleSize: { type: 'number', minimum: 100 },
      cloneFromAdGroupLinkId: { type: 'string' },
      arms: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            adLinkId: { type: 'string' },
            trafficShare: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['name', 'adLinkId', 'trafficShare'],
        },
      },
    },
    required: ['campaignLinkId', 'hypothesis', 'primaryMetric'],
  },
  reversible: true,
  riskLevel: 'high',
  validate(input) {
    const obj = (input || {}) as Record<string, unknown>
    const primary = obj.primaryMetric
    if (primary !== 'ctr' && primary !== 'cvr')
      throw new Error('primaryMetric must be ctr or cvr')
    const hypothesis = requireString(input, 'hypothesis')
    if (hypothesis.length < 10) throw new Error('hypothesis must be ≥ 10 chars')

    const out: Input = {
      campaignLinkId: requireString(input, 'campaignLinkId'),
      hypothesis,
      primaryMetric: primary,
      arms: [],
    }

    const cloneFrom = obj.cloneFromAdGroupLinkId
    if (typeof cloneFrom === 'string' && cloneFrom.length > 0) {
      out.cloneFromAdGroupLinkId = cloneFrom
    }

    if (Array.isArray(obj.arms)) {
      const validatedArms: Arm[] = obj.arms.map((a, i) => {
        const ao = (a || {}) as Record<string, unknown>
        const name = typeof ao.name === 'string' ? ao.name : ''
        const adLinkId = typeof ao.adLinkId === 'string' ? ao.adLinkId : ''
        const ts = typeof ao.trafficShare === 'number' ? ao.trafficShare : NaN
        if (!name || !adLinkId || !Number.isFinite(ts))
          throw new Error(`arm[${i}] missing name/adLinkId/trafficShare`)
        return { name, adLinkId, trafficShare: ts }
      })
      if (validatedArms.length !== 2) throw new Error('arms must be exactly 2')
      const totalShare = validatedArms.reduce((s, a) => s + a.trafficShare, 0)
      if (Math.abs(totalShare - 1) > 0.01) throw new Error('arm traffic shares must sum to 1.0')
      out.arms = validatedArms
    }

    if (!out.cloneFromAdGroupLinkId && out.arms.length === 0) {
      throw new Error('Either cloneFromAdGroupLinkId or arms[] must be provided')
    }

    if (typeof obj.durationHours === 'number' && Number.isFinite(obj.durationHours))
      out.durationHours = obj.durationHours
    if (typeof obj.minSampleSize === 'number' && Number.isFinite(obj.minSampleSize))
      out.minSampleSize = obj.minSampleSize
    return out
  },
  async execute(ctx, input) {
    const link = await prisma.platformLink.findFirst({
      where: { id: input.campaignLinkId, orgId: ctx.orgId, entityType: 'campaign' },
    })
    if (!link) return { ok: false, error: 'campaignLinkId not in org' }

    if (ctx.mode === 'shadow') {
      return {
        ok: true,
        output: {
          skipped: true,
          would: 'start_experiment',
          campaignLinkId: input.campaignLinkId,
          armCount: input.arms.length || 2,
          willClone: !!input.cloneFromAdGroupLinkId,
        },
      }
    }

    let arms = input.arms
    let cloneRecord: { sourceAdGroupLinkId: string; clonedAdGroupLinkId: string } | null = null

    // If cloneFromAdGroupLinkId was provided, perform the clone now.
    if (input.cloneFromAdGroupLinkId) {
      const sourceLink = await prisma.platformLink.findFirst({
        where: {
          id: input.cloneFromAdGroupLinkId,
          orgId: ctx.orgId,
          entityType: 'adgroup',
        },
      })
      if (!sourceLink) {
        return { ok: false, error: 'cloneFromAdGroupLinkId not in org' }
      }
      if (!isAdaptablePlatform(link.platform)) {
        return { ok: false, error: `Platform ${link.platform} not adaptable` }
      }
      const auth = await prisma.platformAuth.findFirst({
        where: { orgId: ctx.orgId, platform: link.platform, isActive: true },
      })
      if (!auth) return { ok: false, error: `No ${link.platform} auth` }
      try {
        const adapter = getAdapter(link.platform, auth)
        const cloned = await adapter.createAdGroup({
          platformCampaignId: link.platformEntityId,
          name: `${sourceLink.platformEntityId} variant ${new Date().toISOString().slice(0, 10)}`,
        })
        const newLink = await upsertPlatformLink({
          orgId: ctx.orgId,
          platform: link.platform,
          accountId: adapter.accountId,
          entityType: 'adgroup',
          localEntityId: cloned.platformAdGroupId,
          platformEntityId: cloned.platformAdGroupId,
          metadata: { source: 'start_experiment_clone', clonedFromLinkId: sourceLink.id },
        })
        arms = [
          { name: 'control', adLinkId: sourceLink.id, trafficShare: 0.5 },
          { name: 'variant', adLinkId: newLink.id, trafficShare: 0.5 },
        ]
        cloneRecord = {
          sourceAdGroupLinkId: sourceLink.id,
          clonedAdGroupLinkId: newLink.id,
        }
      } catch (err) {
        if (err instanceof PlatformError) {
          return { ok: false, error: `Clone failed: ${err.message}`, code: err.code }
        }
        throw err
      }
    }

    const durationHours = input.durationHours ?? 168
    const exp = await prisma.experiment.create({
      data: {
        orgId: ctx.orgId,
        campaignLinkId: input.campaignLinkId,
        hypothesis: input.hypothesis.slice(0, 500),
        status: 'running',
        startedAt: new Date(),
        endsAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
        primaryMetric: input.primaryMetric,
        minSampleSize: input.minSampleSize ?? 1000,
        arms: { create: arms },
      },
    })
    return {
      ok: true,
      output: {
        experimentId: exp.id,
        arms: arms.map((a) => ({ name: a.name, share: a.trafficShare })),
        cloned: cloneRecord,
      },
    }
  },
}
