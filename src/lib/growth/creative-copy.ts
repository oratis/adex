/**
 * Ad copy generation that FITS each platform's character limits (pure fit/
 * validate layer + LLM generation with a deterministic fallback). Part of the
 * material (物料) capability: a variant's headline/primary/CTA must respect the
 * spec's TextLimits or the platform rejects it.
 *
 * Ref: docs/growth/03-creative-studio.md
 */

import { completeJSON, isLLMConfigured } from '@/lib/llm'
import type { TextLimits } from './creative-specs'

export interface AdCopy {
  headline?: string
  primaryText?: string
  cta?: string
}

/** Truncate to `max` chars on a word boundary, appending … when cut. */
export function fitText(s: string, max: number | undefined): string {
  if (!max || s.length <= max) return s
  if (max <= 1) return s.slice(0, max)
  const slice = s.slice(0, max - 1)
  const lastSpace = slice.lastIndexOf(' ')
  const base = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice
  return base.replace(/[\s,.;:!-]+$/, '') + '…'
}

/** Fit every field of an AdCopy to the spec's limits. */
export function fitCopy(copy: AdCopy, limits: TextLimits): AdCopy {
  return {
    headline: copy.headline !== undefined ? fitText(copy.headline, limits.headlineMax) : undefined,
    primaryText: copy.primaryText !== undefined ? fitText(copy.primaryText, limits.primaryTextMax) : undefined,
    cta: copy.cta !== undefined ? fitText(copy.cta, limits.ctaMax) : undefined,
  }
}

/** Report any field that exceeds its limit (before fitting). */
export function validateCopy(copy: AdCopy, limits: TextLimits): string[] {
  const issues: string[] = []
  const check = (name: string, val: string | undefined, max: number | undefined) => {
    if (val !== undefined && max !== undefined && val.length > max) issues.push(`${name} ${val.length} > ${max}`)
  }
  check('headline', copy.headline, limits.headlineMax)
  check('primaryText', copy.primaryText, limits.primaryTextMax)
  check('cta', copy.cta, limits.ctaMax)
  return issues
}

export interface CopyContext {
  product: string
  audience?: string | null
  angle?: string | null
  hook?: string | null
  language?: string
}

const DEFAULT_CTAS = ['Get the app', 'Play now', 'Try it free', 'Start your story']

/** Deterministic fallback copy — used when no LLM is configured. */
export function fallbackCopy(ctx: CopyContext): AdCopy {
  const cta = DEFAULT_CTAS[(ctx.hook?.length ?? ctx.product.length) % DEFAULT_CTAS.length]
  const lead = ctx.angle || ctx.hook || ctx.product
  return {
    headline: ctx.product,
    primaryText: ctx.audience ? `${lead} — made for ${ctx.audience}.` : `${lead}.`,
    cta,
  }
}

/**
 * Generate platform-fitted ad copy. Uses the LLM when configured (asked to
 * respect the exact limits), else the deterministic fallback. Always fits the
 * result to `limits` so the output never exceeds the platform maximums.
 */
export async function generateCopy(ctx: CopyContext, limits: TextLimits): Promise<AdCopy> {
  let base: AdCopy
  if (!isLLMConfigured()) {
    base = fallbackCopy(ctx)
  } else {
    try {
      const lim = [
        limits.headlineMax ? `headline ≤ ${limits.headlineMax}` : null,
        limits.primaryTextMax ? `primaryText ≤ ${limits.primaryTextMax}` : null,
        limits.ctaMax ? `cta ≤ ${limits.ctaMax}` : null,
      ].filter(Boolean).join(', ')
      const prompt =
        `Write ad copy for "${ctx.product}"` +
        `${ctx.audience ? ` targeting ${ctx.audience}` : ''}` +
        `${ctx.angle ? `, angle: ${ctx.angle}` : ''}` +
        `${ctx.hook ? `, hook: ${ctx.hook}` : ''}` +
        `${ctx.language && ctx.language !== 'en' ? ` in language ${ctx.language}` : ''}.\n` +
        `Respect these character limits: ${lim}. ` +
        `Return JSON {"headline":..,"primaryText":..,"cta":..}.`
      base = await completeJSON<AdCopy>(prompt, { maxTokens: 400, temperature: 0.7 })
      if (!base || typeof base !== 'object') base = fallbackCopy(ctx)
    } catch {
      base = fallbackCopy(ctx)
    }
  }
  return fitCopy(base, limits)
}
