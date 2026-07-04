import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { requireString, requireNumber, optionalString } from './_helpers'

type Input = { fromChannel: string; toChannel: string; amountUsd: number; rationale?: string }

/**
 * Propose moving budget between channels (e.g. Meta iOS → ASA). HIGH risk and
 * approval-gated — the concrete budget moves happen via adjust_daily_budget on
 * specific campaigns after a human approves this cross-channel plan. Records the
 * proposed reallocation; does not itself change spend.
 */
export const reallocateChannelBudgetTool: ToolDefinition<Input> = {
  name: 'reallocate_channel_budget',
  description:
    'Propose moving daily budget from one channel to another. High-risk, approval-gated; records the plan, does not move money itself.',
  inputSchema: {
    type: 'object',
    properties: {
      fromChannel: { type: 'string', minLength: 1 },
      toChannel: { type: 'string', minLength: 1 },
      amountUsd: { type: 'number', exclusiveMinimum: 0 },
      rationale: { type: 'string' },
    },
    required: ['fromChannel', 'toChannel', 'amountUsd'],
  },
  reversible: false,
  riskLevel: 'high',
  validate(input) {
    const amountUsd = requireNumber(input, 'amountUsd')
    if (amountUsd <= 0) throw new Error('amountUsd must be > 0')
    const fromChannel = requireString(input, 'fromChannel')
    const toChannel = requireString(input, 'toChannel')
    if (fromChannel === toChannel) throw new Error('fromChannel and toChannel must differ')
    const out: Input = { fromChannel, toChannel, amountUsd }
    const rationale = optionalString(input, 'rationale')
    if (rationale) out.rationale = rationale
    return out
  },
  async execute(ctx, input) {
    await prisma.auditEvent.create({
      data: {
        orgId: ctx.orgId,
        userId: null,
        action: 'advisor.apply',
        targetType: null,
        targetId: null,
        metadata: JSON.stringify({ source: 'agent.reallocate_channel_budget', decisionId: ctx.decisionId, ...input }),
      },
    })
    return { ok: true, output: { proposed: true, fromChannel: input.fromChannel, toChannel: input.toChannel, amountUsd: input.amountUsd } }
  },
}
