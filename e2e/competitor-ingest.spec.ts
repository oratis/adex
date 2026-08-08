/**
 * E2E smoke — competitor-intel ingest + read surface (P22 Phase 1).
 *
 * Always-run (DB-independent, like smoke.spec.ts): the HMAC gate rejects
 * unsigned / bad-signature / missing-org requests, and the read surface is
 * auth-gated.
 *
 * Conditional (needs INGEST_WEBHOOK_SECRET): a signed batch upserts
 * idempotently — the same body POSTed twice creates rows once, then only
 * updates, and the off-target row is dropped by the relevance filter. Skips
 * gracefully when the secret is absent (offline runs), mirroring the repo's
 * env-gated jobs (e.g. prompt-eval skips without ANTHROPIC_API_KEY).
 *
 * Ref: docs/growth/06-competitor-intel-remix.md §4–5 · .claude/rules/testing.md
 */
import { test, expect } from '@playwright/test'
import { sign } from './helpers/hmac'

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''
const p = (path: string) => `${BASE_PATH}${path.startsWith('/') ? path : '/' + path}`

// Trimmed capture of competitor_ingest_batch.json — 2 keep-able discovery rows,
// 1 FILTER-OUT row (dropped), 1 enriched row (no media URL → hermetic, no fetch).
const SAMPLE_BATCH = {
  source: 'appgrowing',
  capturedAt: '2026-07-08',
  discovery: [
    {
      app: 'Talkie: Personalized AI Chats',
      advertiser: 'SUBSUP',
      relevance: 'core',
      headline: 'Unleash a Universe of AI Personalities',
      language: 'en',
      impressions: '>10M-tier',
    },
    {
      app: 'Dating and Chat - Only Spark',
      advertiser: 'Red Panda App',
      relevance: 'adjacent-dating',
      headline: 'online meeting',
      language: 'ar',
      region: 'MENA',
      adDays: 634,
      impressions: '>10M',
      media: ['messenger', 'instagram', 'facebook'],
      duration: '2023-08-03~2025-10-03',
    },
    {
      app: 'Talkie Walkie Zello PTT',
      advertiser: 'Zello',
      relevance: 'FILTER-OUT-keyword-false-match',
      headline: 'TURN YOUR CELL PHONE INTO A WALKIE TALKIE',
      adDays: 168,
      _filterReason: 'walkie-talkie app; matched keyword Talkie but not an AI companion',
    },
  ],
  enriched: [
    {
      externalId: '905b9ca7cf1aa242f4862dba937d29f9-202',
      app: 'Talkie: Creative AI Community',
      advertiser: 'SUBSUP',
      relevance: 'core',
      format: 'Vertical Video 720x1280 (9:16), Rewarded',
      region: 'TR',
      language: 'en',
      adDays: 1,
      impressions: 400,
      duration: '2026-07-04~2026-07-04',
      creativeTags: ['Real Scene', '2D', 'Anime Characters'],
      sellingPoints: ['Genuine interaction', 'Social sharing'],
      aiPromptStructure: 'subject{name,description}+composition{angle}+next_scene',
    },
  ],
}

test.describe('competitor ingest — auth gate', () => {
  test('missing ?org → 400', async ({ request }) => {
    const res = await request.post(p('/api/ingest/competitor'), { data: SAMPLE_BATCH })
    expect(res.status()).toBe(400)
  })

  test('unsigned request → 401', async ({ request }) => {
    const res = await request.post(p('/api/ingest/competitor?org=any-org'), {
      headers: { 'content-type': 'application/json' },
      data: SAMPLE_BATCH,
    })
    expect(res.status()).toBe(401)
  })

  test('bad signature → 401', async ({ request }) => {
    const res = await request.post(p('/api/ingest/competitor?org=any-org'), {
      headers: {
        'content-type': 'application/json',
        'x-adex-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-adex-signature': 'sha256=deadbeef',
      },
      data: JSON.stringify(SAMPLE_BATCH),
    })
    expect(res.status()).toBe(401)
  })
})

test.describe('competitor read surface', () => {
  test('GET /api/competitors requires auth → 401', async ({ request }) => {
    const res = await request.get(p('/api/competitors'))
    expect(res.status()).toBe(401)
  })
})

test.describe('competitor ingest — idempotent upsert', () => {
  test('same signed batch upserts once, then only updates', async ({ request }) => {
    const secret = process.env.INGEST_WEBHOOK_SECRET
    test.skip(!secret, 'requires INGEST_WEBHOOK_SECRET (set in CI against a live Postgres)')

    // A fresh org id per run keeps the (orgId, source, externalId) keys unique,
    // so the first POST always creates and the second always updates.
    const orgId = `e2e-competitor-${Date.now()}`
    const url = p(`/api/ingest/competitor?org=${orgId}`)
    const body = JSON.stringify(SAMPLE_BATCH)

    const s1 = sign(secret!, body)
    const res1 = await request.post(url, {
      headers: { 'content-type': 'application/json', 'x-adex-timestamp': s1.timestamp, 'x-adex-signature': s1.signature },
      data: body,
    })
    expect(res1.status()).toBe(200)
    const j1 = await res1.json()
    expect(j1.filtered).toBe(1) // the FILTER-OUT row is dropped
    expect(j1.created).toBe(3) // 2 discovery + 1 enriched
    expect(j1.updated).toBe(0)

    const s2 = sign(secret!, body)
    const res2 = await request.post(url, {
      headers: { 'content-type': 'application/json', 'x-adex-timestamp': s2.timestamp, 'x-adex-signature': s2.signature },
      data: body,
    })
    expect(res2.status()).toBe(200)
    const j2 = await res2.json()
    expect(j2.created).toBe(0) // idempotent — no duplicate rows
    expect(j2.updated).toBe(3)
    expect(j2.filtered).toBe(1)
  })
})
