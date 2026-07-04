import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { requireString, optionalString } from './_helpers'

type Input = { creativeId: string; reason?: string }

/**
 * Pause a fatigued / low-win-rate creative (org-scoped). Down-only and local:
 * sets Creative.status='paused' so it stops being rotated in; the platform-side
 * pause of ads using it is a separate adapter step. Reversible=false keeps the
 * agent from silently un-pausing.
 */
export const pauseCreativeTool: ToolDefinition<Input> = {
  name: 'pause_creative',
  description:
    "Pause a fatigued or low-performing creative so it stops being rotated in. Sets the creative's status to paused.",
  inputSchema: {
    type: 'object',
    properties: {
      creativeId: { type: 'string', minLength: 1 },
      reason: { type: 'string' },
    },
    required: ['creativeId'],
  },
  reversible: false,
  riskLevel: 'medium',
  validate(input) {
    const out: Input = { creativeId: requireString(input, 'creativeId') }
    const reason = optionalString(input, 'reason')
    if (reason) out.reason = reason
    return out
  },
  async execute(ctx, input) {
    const creative = await prisma.creative.findFirst({ where: { id: input.creativeId, orgId: ctx.orgId } })
    if (!creative) return { ok: false, error: `Creative ${input.creativeId} not found in org`, code: 'not_found' }
    await prisma.creative.update({ where: { id: creative.id }, data: { status: 'paused' } })
    await prisma.auditEvent.create({
      data: {
        orgId: ctx.orgId,
        userId: null,
        action: 'advisor.apply',
        targetType: 'creative',
        targetId: creative.id,
        metadata: JSON.stringify({ source: 'agent.pause_creative', decisionId: ctx.decisionId, reason: input.reason ?? null }),
      },
    })
    return { ok: true, output: { paused: true, creativeId: creative.id } }
  },
}
