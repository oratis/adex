import crypto from 'node:crypto'
import { completeWithStructuredTool, isLLMConfigured } from '@/lib/llm'
import { prisma } from '@/lib/prisma'
import { toolCatalogForPrompt, getTool } from './tools'
import { loadPrompt, renderPrompt } from './prompts/loader'
import type { PerceiveSnapshot, PlanResult, ProposedDecision, Severity } from './types'

const VALID_SEVERITIES: Severity[] = ['info', 'opportunity', 'warning', 'alert']

/**
 * Approximate Anthropic Claude Sonnet 4.5 pricing for cost telemetry.
 * Cached reads are 0.1x of base input; writes are 1.25x. Refresh from the
 * Anthropic pricing page when prices change.
 */
const PRICING = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.3,
  cacheWritePerMillion: 3.75,
} as const

function priceUsd(opts: {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}): number {
  return (
    (opts.input / 1_000_000) * PRICING.inputPerMillion +
    (opts.output / 1_000_000) * PRICING.outputPerMillion +
    (opts.cacheRead / 1_000_000) * PRICING.cacheReadPerMillion +
    (opts.cacheWrite / 1_000_000) * PRICING.cacheWritePerMillion
  )
}

function validateProposed(raw: unknown): ProposedDecision[] {
  if (!raw || typeof raw !== 'object') return []
  const decisions = (raw as { decisions?: unknown }).decisions
  if (!Array.isArray(decisions)) return []
  const out: ProposedDecision[] = []
  for (const d of decisions) {
    if (!d || typeof d !== 'object') continue
    const rationale = String((d as Record<string, unknown>).rationale || '').trim()
    const severity = String((d as Record<string, unknown>).severity || 'info') as Severity
    const steps = (d as Record<string, unknown>).steps
    if (!rationale || !VALID_SEVERITIES.includes(severity) || !Array.isArray(steps)) continue
    const validSteps: ProposedDecision['steps'] = []
    for (const s of steps) {
      if (!s || typeof s !== 'object') continue
      const toolName = String((s as Record<string, unknown>).tool || '')
      const tool = getTool(toolName)
      if (!tool) continue
      const input = (s as Record<string, unknown>).input
      try {
        tool.validate(input)
      } catch {
        continue
      }
      const reason = String((s as Record<string, unknown>).reason || '').trim() || undefined
      validSteps.push({
        tool: toolName,
        input: input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
        reason,
      })
    }
    if (validSteps.length === 0) continue
    out.push({ rationale, severity, steps: validSteps })
  }
  return out
}

export type PlanResultWithMeta = PlanResult & {
  promptVersionId: string
  promptVersionLabel: string
  promptRunId: string | null
}

/**
 * Build the static (cacheable) part of the system prompt — tool catalog +
 * the rendered template up to the campaigns block. We split here so the
 * Anthropic prompt cache returns the per-org volatile part separately on
 * each call, preserving most of the input-token cost reduction.
 */
function splitPromptForCaching(template: string): { stable: string; volatileMarker: string } {
  // Convention: the v1 template ends its stable section right before the
  // "## Recent decisions" header. We split on that marker.
  const splitMarker = '## Recent decisions'
  const idx = template.indexOf(splitMarker)
  if (idx < 0) return { stable: template, volatileMarker: '' }
  return {
    stable: template.slice(0, idx),
    volatileMarker: template.slice(idx),
  }
}

export async function plan(
  snapshot: PerceiveSnapshot,
  opts: { promptHint?: string } = {}
): Promise<PlanResultWithMeta> {
  void opts
  if (!isLLMConfigured()) {
    return {
      decisions: [
        {
          rationale: 'LLM not configured — agent in pass-through mode',
          severity: 'info',
          steps: [{ tool: 'noop', input: {}, reason: 'No ANTHROPIC_API_KEY' }],
        },
      ],
      llm: { model: 'unconfigured', inputTokens: 0, outputTokens: 0, costUsd: 0 },
      promptVersionId: 'disk:agent.plan@v1',
      promptVersionLabel: 'agent.plan@v1',
      promptRunId: null,
    }
  }

  const prompt = await loadPrompt('agent.plan', snapshot.orgId)
  const split = splitPromptForCaching(prompt.template)
  const cachedSystem = renderPrompt(split.stable, {
    TOOL_CATALOG_JSON: JSON.stringify(toolCatalogForPrompt(), null, 2),
    RECENT_DECISIONS_JSON: '',
    GUARDRAIL_HINTS: '',
    CAMPAIGNS_JSON: '',
  })
  const volatileBody = renderPrompt(split.volatileMarker, {
    TOOL_CATALOG_JSON: '',
    RECENT_DECISIONS_JSON: JSON.stringify(snapshot.recentDecisions, null, 2),
    GUARDRAIL_HINTS:
      snapshot.guardrailHints.length === 0
        ? '(none configured — only built-in defaults apply)'
        : snapshot.guardrailHints.join('\n'),
    CAMPAIGNS_JSON: JSON.stringify(snapshot.campaigns, null, 2),
  })

  const submitTool = {
    name: 'submit_decisions',
    description:
      'Submit zero or more proposed decisions. The server-side guardrails decide whether each step actually executes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        decisions: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            required: ['rationale', 'severity', 'steps'],
            properties: {
              rationale: { type: 'string' as const, minLength: 1 },
              severity: { type: 'string' as const, enum: VALID_SEVERITIES },
              steps: {
                type: 'array' as const,
                minItems: 1,
                items: {
                  type: 'object' as const,
                  required: ['tool', 'input'],
                  properties: {
                    tool: { type: 'string' as const },
                    input: { type: 'object' as const },
                    reason: { type: 'string' as const },
                  },
                },
              },
            },
          },
        },
      },
      required: ['decisions'],
    },
  }

  const startedAt = Date.now()
  const result = await completeWithStructuredTool<{ decisions: unknown[] }>({
    tool: submitTool,
    cachedSystem,
    user: volatileBody || '(no campaigns context — propose noop)',
    maxTokens: 2048,
    temperature: 0.3,
  })
  const decisions = validateProposed(result.parsed)

  const costUsd = priceUsd({
    input: result.inputTokens,
    output: result.outputTokens,
    cacheRead: result.cacheReadTokens,
    cacheWrite: result.cacheCreateTokens,
  })

  const inputHash = crypto
    .createHash('sha256')
    .update(cachedSystem + '\n---\n' + volatileBody)
    .digest('hex')

  let promptRunId: string | null = null
  if (!prompt.id.startsWith('disk:')) {
    try {
      const run = await prisma.promptRun.create({
        data: {
          promptVersionId: prompt.id,
          inputHash,
          inputTokens: result.inputTokens + result.cacheCreateTokens + result.cacheReadTokens,
          outputTokens: result.outputTokens,
          latencyMs: Date.now() - startedAt,
          costUsd,
          rawOutput: JSON.stringify(result.parsed).slice(0, 64_000),
          parsed: decisions.length > 0,
        },
      })
      promptRunId = run.id
    } catch (e) {
      console.error('[plan] PromptRun persist failed:', e)
    }
  }

  return {
    decisions,
    llm: {
      model: result.model,
      inputTokens: result.inputTokens + result.cacheCreateTokens + result.cacheReadTokens,
      outputTokens: result.outputTokens,
      costUsd,
      requestId: result.requestId,
    },
    promptVersionId: prompt.id,
    promptVersionLabel: 'agent.plan@v1',
    promptRunId,
  }
}
