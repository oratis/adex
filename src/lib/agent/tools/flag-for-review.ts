import { prisma } from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { requireString } from './_helpers'

type Input = { campaignId?: string; subject: string; details: string }

export const flagForReviewTool: ToolDefinition<Input> = {
  name: 'flag_for_review',
  description:
    "Surface an issue to a human for review. Doesn't change any state — adds an audit entry.",
  inputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      subject: { type: 'string', minLength: 1 },
      details: { type: 'string', minLength: 1 },
    },
    required: ['subject', 'details'],
  },
  reversible: false,
  riskLevel: 'low',
  validate(input) {
    const out: Input = {
      subject: requireString(input, 'subject'),
      details: requireString(input, 'details'),
    }
    if (input && typeof input === 'object') {
      const cid = (input as Record<string, unknown>).campaignId
      if (typeof cid === 'string') out.campaignId = cid
    }
    return out
  },
  async execute(ctx, input) {
    await prisma.auditEvent.create({
      data: {
        orgId: ctx.orgId,
        userId: null,
        action: 'advisor.apply', // closest existing AuditAction
        targetType: input.campaignId ? 'campaign' : null,
        targetId: input.campaignId || null,
        metadata: JSON.stringify({
          source: 'agent.flag_for_review',
          decisionId: ctx.decisionId,
          subject: input.subject,
          details: input.details,
        }),
      },
    })
    return { ok: true, output: { flagged: true, subject: input.subject } }
  },
}
