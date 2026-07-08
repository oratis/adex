/**
 * Competitor-remix 合龙 contract (pure-logic — e2e CI runs with no database, so
 * the DB-backed route can't be hit; this guards the exact transformation the
 * route delegates to). An ingested CompetitorCreative row must flow through the
 * remix chain to an IP-safe text2video Seedance2 request: borrow structure,
 * never the competitor's brand/IP, land review-gated.
 *
 * Ref: src/app/api/creatives/remix/route.ts · src/lib/growth/remix-brief.ts
 */
import { test, expect } from '@playwright/test'
import {
  competitorCreativeToAnalysis,
  deterministicRemixBrief,
  remixBriefToSeedanceRequest,
} from '../src/lib/growth/remix-brief'

const TALKIE_ROW = {
  externalId: 'talkie-202',
  appName: 'Talkie: Creative AI Community',
  adFormat: 'Vertical Video 720x1280 (9:16), Rewarded',
  ratio: '9:16',
  duration: 28,
  sellingPoints: ['Genuine interaction', 'Social sharing'],
  emotionalTriggers: ['Love resonates'],
  screenUnderstanding: ['Talkie brand logo', 'Character card array'],
}
const CUDDLER = {
  product: 'Cuddler',
  positioning: 'an AI companion who is always there',
  audience: '18-28, lonely late nights',
  artDirection: 'warm cozy 2.5D animation',
  cta: 'Meet yours',
  differentiation: 'Not a character to collect — one companion who remembers you.',
  forbidden: ['Talkie'],
}

test.describe('creatives/remix chain', () => {
  test('ingested competitor row → IP-safe text2video generate request', () => {
    const analysis = competitorCreativeToAnalysis(TALKIE_ROW)
    const brief = deterministicRemixBrief(analysis, CUDDLER)
    const req = remixBriefToSeedanceRequest(brief)

    expect(req.mode).toBe('text2video')
    expect(req.ratio).toBe('9:16') // borrowed structure
    expect(req.duration).toBe(10) // clamped to the render window

    // Never the competitor's brand / specific on-screen IP.
    expect(req.prompt).not.toContain('Talkie')
    expect(req.prompt).not.toContain('Character card array')

    // Review-gated, derive-not-copy.
    expect(brief.compliance.reviewStatus).toBe('pending')
    expect(brief.compliance.reusesCompetitorIP).toBe(false)
    expect(brief.sourceRef).toBe('talkie-202')
  })
})
