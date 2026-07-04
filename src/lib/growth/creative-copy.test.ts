import { describe, it, expect } from 'vitest'
import { fitText, fitCopy, validateCopy, fallbackCopy, generateCopy } from './creative-copy'

describe('fitText', () => {
  it('leaves short text unchanged', () => {
    expect(fitText('hello', 40)).toBe('hello')
    expect(fitText('hello', undefined)).toBe('hello')
  })
  it('truncates on a word boundary with an ellipsis, within the limit', () => {
    const out = fitText('the quick brown fox jumps over', 15)
    expect(out.length).toBeLessThanOrEqual(15)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toContain('  ')
  })
  it('hard-cuts when there is no good word boundary', () => {
    const out = fitText('supercalifragilistic', 10)
    expect(out.length).toBeLessThanOrEqual(10)
  })
})

describe('validateCopy / fitCopy', () => {
  const limits = { headlineMax: 10, primaryTextMax: 20, ctaMax: 8 }
  it('flags over-limit fields', () => {
    const issues = validateCopy({ headline: 'way too long headline', cta: 'clickclick' }, limits)
    expect(issues.join()).toContain('headline')
    expect(issues.join()).toContain('cta')
  })
  it('fitCopy brings every field within limits', () => {
    const fitted = fitCopy({ headline: 'way too long headline', primaryText: 'also quite long text here', cta: 'clickclick' }, limits)
    expect((fitted.headline ?? '').length).toBeLessThanOrEqual(10)
    expect((fitted.primaryText ?? '').length).toBeLessThanOrEqual(20)
    expect((fitted.cta ?? '').length).toBeLessThanOrEqual(8)
  })
})

describe('fallbackCopy', () => {
  it('produces headline/primary/cta from context', () => {
    const c = fallbackCopy({ product: 'Cuddler', audience: 'RP fans', angle: 'chat becomes film' })
    expect(c.headline).toBe('Cuddler')
    expect(c.primaryText).toContain('RP fans')
    expect(c.cta).toBeTruthy()
  })
})

describe('generateCopy (no LLM → fallback, always fitted)', () => {
  it('returns copy fitted to the limits without an API key', async () => {
    // ANTHROPIC_API_KEY is unset in test → isLLMConfigured() false → fallback path.
    const out = await generateCopy(
      { product: 'Cuddler — Playable Stories', audience: 'creators', angle: 'turn roleplay into cinematic video' },
      { headlineMax: 12, primaryTextMax: 25, ctaMax: 10 },
    )
    expect((out.headline ?? '').length).toBeLessThanOrEqual(12)
    expect((out.primaryText ?? '').length).toBeLessThanOrEqual(25)
    expect((out.cta ?? '').length).toBeLessThanOrEqual(10)
  })
})
