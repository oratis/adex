import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { requireString, optionalString } from './_helpers'

type Input = { metric: string; detail: string; channel?: string; severity?: string }

/**
 * Surface a growth alert (CAC breach, D1 drop, negative-review spike, budget
 * pacing) to humans. Records-only — the human decides the action. This is the
 * agent's channel for organic/growth signals that can't be auto-executed.
 */
export const raiseGrowthAlertTool: ToolDefinition<Input> = {
  name: 'raise_growth_alert',
  description:
    'Raise a growth alert for a human (CAC/D1/review/budget signal). Changes no state; adds an audit entry.',
  inputSchema: {
    type: 'object',
    properties: {
      metric: { type: 'string', minLength: 1 },
      detail: { type: 'string', minLength: 1 },
      channel: { type: 'string' },
      severity: { type: 'string', enum: ['info', 'warning', 'alert'] },
    },
    required: ['metric', 'detail'],
  },
  reversible: false,
  riskLevel: 'low',
  validate(input) {
    const out: Input = { metric: requireString(input, 'metric'), detail: requireString(input, 'detail') }
    const ch = optionalString(input, 'channel')
    if (ch) out.channel = ch
    const sev = optionalString(input, 'severity')
    if (sev && ['info', 'warning', 'alert'].includes(sev)) out.severity = sev
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
        metadata: JSON.stringify({ source: 'agent.raise_growth_alert', decisionId: ctx.decisionId, ...input }),
      },
    })
    return { ok: true, output: { alerted: true, metric: input.metric } }
  },
}
