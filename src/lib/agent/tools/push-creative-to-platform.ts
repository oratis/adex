import { prisma } from '@/lib/prisma'
import { getAdapter, isAdaptablePlatform } from '@/lib/platforms/registry'
import { upsertPlatformLink } from '@/lib/platforms/links'
import { PlatformError } from '@/lib/platforms/adapter'
import type { ToolDefinition } from '../types'
import { requireString } from './_helpers'

type Input = { creativeId: string; platform: string }

/**
 * push_creative_to_platform — upload an org creative to the named platform's
 * asset library, persist the resulting platformAssetId on Creative, and
 * write a PlatformLink (entityType=creative).
 *
 * Refuses to push:
 *   - creatives with reviewStatus !== 'approved' (P15 review gate)
 *   - creatives without fileUrl
 *   - platforms that don't yet implement uploadCreativeAsset (Google for now)
 */
export const pushCreativeToPlatformTool: ToolDefinition<Input> = {
  name: 'push_creative_to_platform',
  description:
    "Upload an approved Creative to a platform's asset library so it can be referenced when creating ads. Requires Creative.reviewStatus='approved'.",
  inputSchema: {
    type: 'object',
    properties: {
      creativeId: { type: 'string' },
      platform: { type: 'string', enum: ['meta', 'tiktok'] },
    },
    required: ['creativeId', 'platform'],
  },
  reversible: false,
  riskLevel: 'medium',
  validate(input) {
    const platform = requireString(input, 'platform')
    if (platform !== 'meta' && platform !== 'tiktok')
      throw new Error('platform must be meta|tiktok')
    return { creativeId: requireString(input, 'creativeId'), platform }
  },
  async execute(ctx, input) {
    const creative = await prisma.creative.findFirst({
      where: { id: input.creativeId, orgId: ctx.orgId },
    })
    if (!creative) return { ok: false, error: `Creative ${input.creativeId} not found in org` }
    if (creative.reviewStatus !== 'approved') {
      return {
        ok: false,
        error: `Creative reviewStatus=${creative.reviewStatus}; must be 'approved' before push`,
      }
    }
    if (!creative.fileUrl) {
      return { ok: false, error: 'Creative has no fileUrl to upload' }
    }
    if (!isAdaptablePlatform(input.platform)) {
      return { ok: false, error: `Adapter not registered for ${input.platform}` }
    }

    if (ctx.mode === 'shadow') {
      return {
        ok: true,
        output: { skipped: true, would: 'push_creative_to_platform', creativeId: creative.id, platform: input.platform },
      }
    }

    const auth = await prisma.platformAuth.findFirst({
      where: { orgId: ctx.orgId, platform: input.platform, isActive: true },
    })
    if (!auth) return { ok: false, error: `No ${input.platform} auth` }

    try {
      const adapter = getAdapter(input.platform, auth)
      const upload = await adapter.uploadCreativeAsset({
        type: creative.type as 'image' | 'video',
        fileUrl: creative.fileUrl,
        name: creative.name,
        width: creative.width ?? undefined,
        height: creative.height ?? undefined,
        duration: creative.duration ?? undefined,
      })
      await prisma.creative.update({
        where: { id: creative.id },
        data: { platformAssetId: upload.platformAssetId },
      })
      const link = await upsertPlatformLink({
        orgId: ctx.orgId,
        platform: input.platform,
        accountId: adapter.accountId,
        entityType: 'creative',
        localEntityId: creative.id,
        platformEntityId: upload.platformAssetId,
        metadata: { type: creative.type, source: 'push_creative_to_platform' },
      })
      return {
        ok: true,
        output: {
          creativeId: creative.id,
          platform: input.platform,
          platformAssetId: upload.platformAssetId,
        },
        platformLinkId: link.id,
      }
    } catch (err) {
      if (err instanceof PlatformError) {
        return { ok: false, error: err.message, code: err.code }
      }
      throw err
    }
  },
}
