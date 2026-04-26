/**
 * Minimal Anthropic Claude API wrapper. Uses fetch (no SDK dep).
 *
 * Env vars:
 *   ANTHROPIC_API_KEY    — required
 *   ANTHROPIC_MODEL      — optional, defaults to claude-sonnet-4-5
 *
 * Call completeText() for plain-text completions, or completeJSON<T>()
 * to force a JSON-only response and parse it.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'

export class LLMNotConfigured extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set')
  }
}

type Message = { role: 'user' | 'assistant'; content: string }

async function anthropicCall(
  messages: Message[],
  opts: { system?: string; maxTokens?: number; temperature?: number }
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new LLMNotConfigured()

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
      ...(opts.system ? { system: opts.system } : {}),
      messages,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 400)}`)
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>
  }
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('')
    .trim()
  return text
}

export async function completeText(
  prompt: string,
  opts: { system?: string; maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  return anthropicCall([{ role: 'user', content: prompt }], opts)
}

export async function completeJSON<T = unknown>(
  prompt: string,
  opts: { system?: string; maxTokens?: number; temperature?: number } = {}
): Promise<T> {
  const system =
    (opts.system ? opts.system + '\n\n' : '') +
    'You MUST respond with valid JSON only — no prose, no code fences, no explanations. ' +
    'The first character of your response must be `{` or `[`.'
  const raw = await anthropicCall([{ role: 'user', content: prompt }], {
    ...opts,
    system,
  })
  // Strip accidental code fences
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // One more attempt: extract the first JSON object/array
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/)
    if (match) return JSON.parse(match[0]) as T
    throw new Error(`LLM did not return valid JSON. Got: ${cleaned.slice(0, 200)}`)
  }
}

export function isLLMConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/**
 * Anthropic Tool Use call with optional prompt-caching markers.
 *
 * Caller defines a single "structured output" tool whose input_schema
 * captures the desired response shape. We force the model to call it via
 * `tool_choice: { type: 'tool', name: tool.name }`. The model's tool_use
 * input is returned as the parsed structured response — no prose, no JSON
 * fences, no extraction heuristics.
 *
 * `cachedSystem` (if provided) is sent as a SystemBlock with
 * `cache_control: { type: 'ephemeral' }` so static prompt + tool catalog
 * are reused across calls. Anthropic charges write-once / read-many for
 * cached blocks, so plan() amortizes cost across cycles within the cache TTL.
 */
export type StructuredTool<T> = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type ToolUseResult<T> = {
  parsed: T
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  requestId?: string
}

export async function completeWithStructuredTool<T = unknown>(opts: {
  tool: StructuredTool<T>
  user: string
  cachedSystem?: string
  freshSystem?: string
  maxTokens?: number
  temperature?: number
}): Promise<ToolUseResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new LLMNotConfigured()

  const systemBlocks: Array<Record<string, unknown>> = []
  if (opts.cachedSystem) {
    systemBlocks.push({
      type: 'text',
      text: opts.cachedSystem,
      cache_control: { type: 'ephemeral' },
    })
  }
  if (opts.freshSystem) {
    systemBlocks.push({ type: 'text', text: opts.freshSystem })
  }

  const body = {
    model: DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.3,
    ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
    tools: [opts.tool],
    tool_choice: { type: 'tool', name: opts.tool.name },
    messages: [{ role: 'user', content: opts.user }],
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Anthropic Tool Use ${res.status}: ${errBody.slice(0, 400)}`)
  }

  const data = (await res.json()) as {
    id?: string
    model?: string
    content: Array<{ type: string; name?: string; input?: unknown; text?: string }>
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
  const block = data.content.find((c) => c.type === 'tool_use' && c.name === opts.tool.name)
  if (!block || block.input == null) {
    throw new Error(
      `Tool Use API did not return a "${opts.tool.name}" tool_use block. Got types: ${data.content
        .map((c) => c.type)
        .join(', ')}`
    )
  }
  return {
    parsed: block.input as T,
    model: data.model || DEFAULT_MODEL,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
    cacheCreateTokens: data.usage?.cache_creation_input_tokens ?? 0,
    requestId: data.id,
  }
}
