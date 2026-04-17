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
