import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { requireString } from './_helpers'

type Input = { channel: string; action: 'scale' | 'hold' | 'kill'; rationale: string }

const ACTIONS = ['scale', 'hold', 'kill'] as const

/**
 * Propose opening / holding / killing a paid channel based on gate data. This
 * is ADVISORY ONLY — it never moves money. Whether and when to scale a channel
 * stays a human decision (the payment_signal_gate discipline). Records the
 * proposal for a human to act on.
 */
export const proposePaidGateChangeTool: ToolDefinition<Input> = {
  name: 'propose_paid_gate_change',
  description:
    'Propose scaling / holding / killing a paid channel from its gate status. Advisory only — never spends; a human decides.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', minLength: 1 },
      action: { type: 'string', enum: [...ACTIONS] },
      rationale: { type: 'string', minLength: 1 },
    },
    required: ['channel', 'action', 'rationale'],
  },
  reversible: false,
  riskLevel: 'low',
  validate(input) {
    const action = requireString(input, 'action')
    if (!(ACTIONS as readonly string[]).includes(action)) throw new Error(`action must be one of ${ACTIONS.join(', ')}`)
    return { channel: requireString(input, 'channel'), action: action as Input['action'], rationale: requireString(input, 'rationale') }
  },
  async execute(ctx, input) {
    await prisma.auditEvent.create({
      data: {
        orgId: ctx.orgId,
        userId: null,
        action: 'advisor.apply',
        targetType: null,
        targetId: null,
        metadata: JSON.stringify({ source: 'agent.propose_paid_gate_change', decisionId: ctx.decisionId, ...input }),
      },
    })
    return { ok: true, output: { proposed: true, channel: input.channel, action: input.action } }
  },
}
