import { prisma } from '@/lib/prisma'
import { getAdapter, isAdaptablePlatform } from '@/lib/platforms/registry'
import { upsertPlatformLink } from '@/lib/platforms/links'
import { PlatformError } from '@/lib/platforms/adapter'
import type { ToolDefinition } from '../types'
import { getOwnedCampaign, requireString, optionalString } from './_helpers'

type Input = {
  sourceCampaignId: string
  newName?: string
  dailyBudget?: number
}

/**
 * clone_campaign — duplicate a winning campaign on the same platform under
 * a new name. Used to scale a proven set-up while preserving the original.
 *
 * Steps:
 *   1. Read source Campaign + first daily Budget.
 *   2. Insert a new local Campaign row in `draft` status (no auto-launch).
 *   3. If platform is adaptable, also call adapter.launchCampaign so the
 *      clone exists on the platform side in PAUSED status, and write a
 *      PlatformLink. The local Campaign.status stays `draft` until a human
 *      flips it (or the agent's resume_campaign tool does).
 */
export const cloneCampaignTool: ToolDefinition<Input> = {
  name: 'clone_campaign',
  description:
    'Duplicate a campaign (same platform, same targeting, optional new daily budget). The clone is created in PAUSED state on the platform; flip it via resume_campaign once approved.',
  inputSchema: {
    type: 'object',
    properties: {
      sourceCampaignId: { type: 'string' },
      newName: { type: 'string' },
      dailyBudget: { type: 'number', minimum: 0 },
    },
    required: ['sourceCampaignId'],
  },
  reversible: false, // creates new entities; cleanup is manual
  riskLevel: 'medium',
  validate(input) {
    const out: Input = { sourceCampaignId: requireString(input, 'sourceCampaignId') }
    const newName = optionalString(input, 'newName')
    if (newName) out.newName = newName
    if (input && typeof input === 'object') {
      const b = (input as Record<string, unknown>).dailyBudget
      if (typeof b === 'number' && Number.isFinite(b) && b > 0) out.dailyBudget = b
    }
    return out
  },
  async execute(ctx, input) {
    const source = await getOwnedCampaign(ctx.orgId, input.sourceCampaignId)
    const sourceBudget = await prisma.budget.findFirst({
      where: { campaignId: source.id, type: 'daily' },
    })
    const newName =
      input.newName || `${source.name} (clone ${new Date().toISOString().slice(0, 10)})`
    const dailyBudget = input.dailyBudget ?? sourceBudget?.amount

    if (ctx.mode === 'shadow') {
      return {
        ok: true,
        output: {
          skipped: true,
          would: 'clone_campaign',
          sourceCampaignId: source.id,
          newName,
          dailyBudget,
        },
      }
    }

    const cloned = await prisma.campaign.create({
      data: {
        orgId: source.orgId,
        userId: source.userId,
        name: newName,
        platform: source.platform,
        status: 'draft',
        desiredStatus: 'paused',
        objective: source.objective,
        targetCountries: source.targetCountries,
        targetAudience: source.targetAudience,
        targetInterests: source.targetInterests,
        ageMin: source.ageMin,
        ageMax: source.ageMax,
        gender: source.gender,
        startDate: source.startDate,
        endDate: source.endDate,
        managedByAgent: source.managedByAgent,
      },
    })
    if (dailyBudget) {
      await prisma.budget.create({
        data: {
          orgId: source.orgId,
          userId: source.userId,
          campaignId: cloned.id,
          type: 'daily',
          amount: dailyBudget,
          currency: sourceBudget?.currency || 'USD',
        },
      })
    }

    // Attempt platform-side launch when an adapter is registered.
    let platformCampaignId: string | null = null
    if (isAdaptablePlatform(source.platform)) {
      const auth = await prisma.platformAuth.findFirst({
        where: { orgId: ctx.orgId, platform: source.platform, isActive: true },
      })
      if (auth) {
        try {
          const adapter = getAdapter(source.platform, auth)
          const launch = await adapter.launchCampaign({
            name: newName,
            objective: source.objective || undefined,
            dailyBudget,
            startDate: source.startDate?.toISOString().split('T')[0],
            endDate: source.endDate?.toISOString().split('T')[0],
            targetCountries: source.targetCountries
              ? (JSON.parse(source.targetCountries) as string[])
              : undefined,
            ageMin: source.ageMin ?? undefined,
            ageMax: source.ageMax ?? undefined,
            gender: (source.gender as 'all' | 'male' | 'female' | undefined) || undefined,
          })
          platformCampaignId = launch.platformCampaignId
          await upsertPlatformLink({
            orgId: ctx.orgId,
            platform: source.platform,
            accountId: adapter.accountId,
            entityType: 'campaign',
            localEntityId: cloned.id,
            platformEntityId: launch.platformCampaignId,
            metadata: { source: 'clone_campaign', clonedFromLocalId: source.id },
          })
          await prisma.campaign.update({
            where: { id: cloned.id },
            data: { platformCampaignId, syncedStatus: 'paused', syncedAt: new Date() },
          })
        } catch (err) {
          if (err instanceof PlatformError) {
            return {
              ok: false,
              error: `Local clone created (${cloned.id}) but platform launch failed: ${err.message}`,
              code: err.code,
            }
          }
          throw err
        }
      }
    }

    return {
      ok: true,
      output: {
        clonedCampaignId: cloned.id,
        platformCampaignId,
        sourceCampaignId: source.id,
      },
    }
  },
}
