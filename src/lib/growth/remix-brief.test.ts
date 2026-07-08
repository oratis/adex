import { describe, it, expect } from 'vitest'
import {
  deterministicRemixBrief,
  remixBriefToSeedanceRequest,
  parseCompetitorAnalysis,
  competitorCreativeToAnalysis,
  type CompetitorAnalysis,
  type ProductBrief,
} from './remix-brief'

const talkie: CompetitorAnalysis = {
  externalId: 'talkie-202',
  app: 'Talkie: Creative AI Community',
  headline: 'Talkie AI: Your companion for your ideal AI friend',
  ratio: '9:16',
  durationSec: 28,
  format: 'Vertical Video / Rewarded',
  creativeTags: ['Real Scene', '2D', 'Anime Characters'],
  sellingPoints: ['Genuine interaction', 'Social sharing', 'Card strength recognition'],
  emotionalTriggers: ['Love resonates', 'Sense of identity'],
  screenUnderstanding: ['Talkie brand logo', 'Character card array', 'Conversation bubbles'],
  audienceProfile: 'Anime enthusiasts',
}

const cuddler: ProductBrief = {
  product: 'Cuddler',
  positioning: 'an AI companion who is always there',
  audience: '18-28, lonely late nights',
  artDirection: 'warm cozy 2.5D animation, amber and dusk-blue palette',
  cta: 'Meet yours',
  differentiation: 'Not a character to collect — one companion who remembers you.',
  forbidden: ['Talkie', 'gacha cards'],
}

describe('deterministicRemixBrief', () => {
  it('borrows the competitor format (ratio) and clamps duration to the render window', () => {
    const b = deterministicRemixBrief(talkie, cuddler)
    expect(b.ratio).toBe('9:16')
    expect(b.durationSec).toBe(10) // clamped from 28
    expect(b.sourceRef).toBe('talkie-202')
  })

  it('asserts derive-not-copy compliance and lands review-gated', () => {
    const b = deterministicRemixBrief(talkie, cuddler)
    expect(b.compliance).toMatchObject({
      deriveNotCopy: true,
      reusesCompetitorIP: false,
      reviewStatus: 'pending',
    })
  })

  it('NEVER leaks the competitor brand/IP into the generated prompt (the core guarantee)', () => {
    const b = deterministicRemixBrief(talkie, cuddler)
    // competitor brand + specific on-screen elements must not appear in our prompt
    expect(b.seedance2Prompt).not.toContain('Talkie')
    expect(b.seedance2Prompt).not.toContain('brand logo')
    expect(b.seedance2Prompt).not.toContain('Character card array')
    // but it must express OUR positioning + explicitly forbid third-party IP
    expect(b.seedance2Prompt).toContain('always there')
    expect(b.seedance2Prompt.toLowerCase()).toContain('original ip only')
  })

  it('builds a hook → scene → end-card storyboard in our product voice', () => {
    const b = deterministicRemixBrief(talkie, cuddler)
    expect(b.storyboard.map((s) => s.role)).toEqual(['hook', 'scene', 'end-card'])
    expect(b.copy.headline).toBe(cuddler.positioning)
    expect(b.copy.cta).toBe('Meet yours')
  })

  it('defaults ratio to 9:16 and duration to 8s when the competitor omits them', () => {
    const b = deterministicRemixBrief({ externalId: 'x' }, cuddler)
    expect(b.ratio).toBe('9:16')
    expect(b.durationSec).toBe(8)
  })
})

describe('competitorCreativeToAnalysis', () => {
  it('maps a persisted row (appName→app, adFormat→format) and coerces JSON arrays', () => {
    const a = competitorCreativeToAnalysis({
      externalId: 'talkie-202',
      appName: 'Talkie',
      adFormat: 'Vertical Video 720x1280 (9:16), Rewarded',
      ratio: '9:16',
      duration: 8,
      sellingPoints: ['Genuine interaction', 'Social sharing'],
      screenUnderstanding: ['Talkie brand logo'],
    })
    expect(a.app).toBe('Talkie')
    expect(a.format).toBe('Vertical Video 720x1280 (9:16), Rewarded')
    expect(a.ratio).toBe('9:16')
    expect(a.durationSec).toBe(8)
    expect(a.sellingPoints).toEqual(['Genuine interaction', 'Social sharing'])
    expect(a.screenUnderstanding).toEqual(['Talkie brand logo'])
  })
  it('coerces an unknown ratio to null and tolerates missing/odd JSON fields', () => {
    const a = competitorCreativeToAnalysis({ externalId: 'e', ratio: '2:1', creativeTags: 'not-an-array' })
    expect(a.ratio).toBeNull()
    expect(a.creativeTags).toEqual([])
    expect(a.app).toBeNull()
  })
  it('feeds the remix so it still never leaks competitor IP', () => {
    const a = competitorCreativeToAnalysis({ externalId: 'x', appName: 'Talkie', screenUnderstanding: ['Talkie brand logo'] })
    const brief = deterministicRemixBrief(a, {
      product: 'Cuddler', positioning: 'always there', audience: 'x', artDirection: 'cozy', cta: 'go',
    })
    expect(brief.seedance2Prompt).not.toContain('Talkie')
  })
})

describe('remixBriefToSeedanceRequest', () => {
  it('produces an IP-safe text2video generate body', () => {
    const b = deterministicRemixBrief(talkie, cuddler)
    const req = remixBriefToSeedanceRequest(b)
    expect(req).toMatchObject({ mode: 'text2video', ratio: '9:16', duration: 10, generateAudio: true })
    expect(req.prompt).toBe(b.seedance2Prompt)
  })
})

describe('parseCompetitorAnalysis', () => {
  it('drops payloads without an externalId', () => {
    expect(parseCompetitorAnalysis({ app: 'x' })).toBeNull()
    expect(parseCompetitorAnalysis(null)).toBeNull()
  })
  it('parses a valid payload and coerces an invalid ratio to null', () => {
    const a = parseCompetitorAnalysis({ externalId: 'e1', app: 'A', ratio: '2:1', sellingPoints: ['x', 'y'] })
    expect(a).not.toBeNull()
    expect(a?.externalId).toBe('e1')
    expect(a?.ratio).toBeNull()
    expect(a?.sellingPoints).toEqual(['x', 'y'])
  })
})
