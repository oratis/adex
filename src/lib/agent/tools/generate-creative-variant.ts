import { prisma } from '@/lib/prisma'
import { SeedreamClient } from '@/lib/platforms/seedream'
import { SeedanceClient } from '@/lib/platforms/seedance'
import type { ToolDefinition } from '../types'
import { requireString, optionalString } from './_helpers'

type Input = {
  basedOnCreativeId?: string
  prompt: string
  type: 'image' | 'video'
  name?: string
  width?: number
  height?: number
  style?: string
}

/**
 * generate_creative_variant — kick off Seedream/Seedance generation for a new
 * variant. The created Creative starts in `reviewStatus='pending'` so it
 * cannot be pushed to a platform until a human admin approves it (P15 work
 * item 6 — creative review gate).
 *
 * Synchronous wrt the AI generator's request handoff: this records the row
 * and returns. Status moves to `ready` when the generator's webhook/poll
 * lands; in practice the seedance2 polling worker handles that.
 */
export const generateCreativeVariantTool: ToolDefinition<Input> = {
  name: 'generate_creative_variant',
  description:
    'Request a new image/video creative variant via Seedream/Seedance. Creates a Creative row in reviewStatus=pending — humans must approve before push_creative_to_platform will run.',
  inputSchema: {
    type: 'object',
    properties: {
      basedOnCreativeId: { type: 'string' },
      prompt: { type: 'string', minLength: 5 },
      type: { type: 'string', enum: ['image', 'video'] },
      name: { type: 'string' },
      width: { type: 'number' },
      height: { type: 'number' },
      style: { type: 'string' },
    },
    required: ['prompt', 'type'],
  },
  reversible: false,
  riskLevel: 'medium',
  validate(input) {
    const obj = (input || {}) as Record<string, unknown>
    const type = obj.type
    if (type !== 'image' && type !== 'video') throw new Error('type must be image|video')
    const out: Input = {
      type,
      prompt: requireString(input, 'prompt'),
    }
    const based = optionalString(input, 'basedOnCreativeId')
    if (based) out.basedOnCreativeId = based
    const name = optionalString(input, 'name')
    if (name) out.name = name
    if (typeof obj.width === 'number') out.width = obj.width
    if (typeof obj.height === 'number') out.height = obj.height
    const style = optionalString(input, 'style')
    if (style) out.style = style
    if (out.prompt.length < 5) throw new Error('prompt too short')
    return out
  },
  async execute(ctx, input) {
    const sourcePlatform = input.type === 'video' ? 'seedance' : 'seedream'
    const auth = await prisma.platformAuth.findFirst({
      where: { orgId: ctx.orgId, platform: sourcePlatform, isActive: true },
    })
    if (!auth?.apiKey) {
      return { ok: false, error: `No ${sourcePlatform} apiKey configured` }
    }

    if (ctx.mode === 'shadow') {
      return {
        ok: true,
        output: {
          skipped: true,
          would: 'generate_creative_variant',
          source: sourcePlatform,
          prompt: input.prompt,
        },
      }
    }

    // Find a creator user — fall back to org createdBy.
    const org = await prisma.organization.findUnique({ where: { id: ctx.orgId } })
    if (!org) return { ok: false, error: 'org not found' }

    const baseName =
      input.name ||
      (input.basedOnCreativeId
        ? `Variant of ${input.basedOnCreativeId.slice(0, 8)} · ${new Date().toISOString().slice(0, 10)}`
        : `Agent variant ${new Date().toISOString().slice(0, 10)}`)

    const created = await prisma.creative.create({
      data: {
        orgId: ctx.orgId,
        userId: org.createdBy,
        name: baseName,
        type: input.type,
        source: 'agent',
        prompt: input.prompt,
        status: 'generating',
        reviewStatus: 'pending',
        width: input.width ?? null,
        height: input.height ?? null,
      },
    })

    try {
      if (input.type === 'video') {
        const client = new SeedanceClient({ apiKey: auth.apiKey })
        await client.generateVideo({ prompt: input.prompt, style: input.style })
      } else {
        const client = new SeedreamClient({ apiKey: auth.apiKey })
        await client.generateImage({
          prompt: input.prompt,
          width: input.width,
          height: input.height,
          style: input.style,
        })
      }
    } catch (err) {
      await prisma.creative.update({
        where: { id: created.id },
        data: { status: 'failed' },
      })
      return {
        ok: false,
        error: `Generator failed: ${err instanceof Error ? err.message : 'unknown'}`,
      }
    }

    return {
      ok: true,
      output: {
        creativeId: created.id,
        reviewStatus: 'pending',
        next: 'human approval via /creatives/review',
      },
    }
  },
}
