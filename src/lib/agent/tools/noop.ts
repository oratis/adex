import type { ToolDefinition } from '../types'

type Input = { reason?: string }

export const noopTool: ToolDefinition<Input> = {
  name: 'noop',
  description:
    'Do nothing. Use when the situation is healthy and no other tool is justified — the rationale becomes a record of "agent looked, all good".',
  inputSchema: {
    type: 'object',
    properties: { reason: { type: 'string' } },
  },
  reversible: false,
  riskLevel: 'low',
  validate(input) {
    if (input && typeof input === 'object') {
      const r = (input as Record<string, unknown>).reason
      if (typeof r === 'string') return { reason: r }
    }
    return {}
  },
  async execute() {
    return { ok: true, output: { noop: true } }
  },
}
