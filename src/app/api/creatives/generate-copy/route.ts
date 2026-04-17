import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { completeJSON, isLLMConfigured } from '@/lib/llm'

type CopyVariant = {
  headline: string
  description: string
  callToAction: string
}

// POST /api/creatives/generate-copy
// Body: { productDescription, audience?, tone?, platform?, count? }
// Returns: { variants: CopyVariant[] }
export async function POST(req: NextRequest) {
  try {
    await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isLLMConfigured()) {
    return NextResponse.json(
      {
        error: 'ANTHROPIC_API_KEY is not set on the server. Configure it to use AI copy generation.',
      },
      { status: 400 }
    )
  }

  try {
    const body = await req.json()
    const {
      productDescription,
      audience = 'general audience',
      tone = 'professional',
      platform = 'multi-platform',
      count = 3,
    } = body

    if (!productDescription || typeof productDescription !== 'string') {
      return NextResponse.json(
        { error: 'productDescription is required' },
        { status: 400 }
      )
    }

    const safeCount = Math.min(Math.max(1, Number(count) || 3), 6)

    const prompt = `Generate ${safeCount} ad copy variants for the product/service below.

Product: ${productDescription}
Target audience: ${audience}
Tone: ${tone}
Platform: ${platform}

Constraints:
- Headline: max 40 characters, attention-grabbing.
- Description: max 90 characters, benefit-led, concrete.
- CTA: max 20 characters, imperative verb (e.g. "Shop Now", "Start Free Trial").

Return JSON: { "variants": [ { "headline": "...", "description": "...", "callToAction": "..." } ] }`

    const result = await completeJSON<{ variants: CopyVariant[] }>(prompt, {
      maxTokens: 1000,
      temperature: 0.8,
    })

    if (!Array.isArray(result.variants)) {
      return NextResponse.json(
        { error: 'LLM returned unexpected shape', raw: result },
        { status: 500 }
      )
    }

    return NextResponse.json({ variants: result.variants })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
