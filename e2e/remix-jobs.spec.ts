/**
 * E2E — the worker-engine RemixJob path (control plane creates the job + brief;
 * the worker claims/report/uploads over HMAC — no video-generation API is ever
 * called from these tests).
 *
 * Mirrors e2e/competitor-ingest.spec.ts's HMAC-signing helper, and shares a single
 * registered user across tests (register is 5/hr/IP rate-limited) — the session
 * cookie is captured in `beforeAll` and reused via a shared `APIRequestContext`.
 *
 * Ref: src/app/api/creatives/remix-jobs/route.ts · src/app/api/worker/remix-jobs/**
 * · src/lib/growth/remix-job.ts
 */
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import crypto from 'node:crypto'

// Every test in this file shares one registered user + session (register is
// 5/hr/IP rate-limited) — run the whole file in a single worker, in order, so
// `beforeAll` only registers once and no two workers race the same account.
test.describe.configure({ mode: 'serial' })

const PORT = process.env.PORT || '3000'
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''
const BASE_URL = `http://localhost:${PORT}`
const p = (path: string) => `${BASE_PATH}${path.startsWith('/') ? path : '/' + path}`

const INGEST_SECRET = process.env.INGEST_WEBHOOK_SECRET || 'e2e-competitor-ingest-secret'
const WORKER_SECRET = process.env.WORKER_WEBHOOK_SECRET || 'e2e-worker-secret'

function sign(secret: string, payload: string) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}:${payload}`).digest('hex')}`
  return { timestamp, signature }
}

// Minimal single-row batch — one enriched competitor creative, no media URL
// (hermetic, no outbound fetch needed by the ingest route).
function sampleBatch(externalId: string) {
  return {
    source: 'appgrowing',
    capturedAt: '2026-07-08',
    discovery: [],
    enriched: [
      {
        externalId,
        app: 'Talkie: Creative AI Community',
        advertiser: 'SUBSUP',
        relevance: 'core',
        format: 'Vertical Video 720x1280 (9:16), Rewarded',
        region: 'TR',
        language: 'en',
        ratio: '9:16',
        duration: 24,
        creativeTags: ['Real Scene', '2D', 'Anime Characters'],
        sellingPoints: ['Genuine interaction', 'Social sharing'],
        emotionalTriggers: ['Love resonates'],
      },
    ],
  }
}

const REMIX_PRODUCT = {
  product: 'Cuddler',
  positioning: 'an AI companion who is always there',
  audience: '18-28, lonely late nights',
  artDirection: 'warm cozy 2.5D animation',
  cta: 'Meet yours',
}

let ctx: APIRequestContext
let orgId: string

test.beforeAll(async () => {
  ctx = await pwRequest.newContext({ baseURL: BASE_URL })

  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `remix-jobs-e2e-${unique}@adex-e2e.dev`
  const res = await ctx.post(p('/api/auth/register'), {
    data: { email, password: 'e2e-test-password-1', name: `Remix Jobs E2E ${unique}` },
  })
  expect(res.ok(), await res.text()).toBeTruthy()

  const orgsRes = await ctx.get(p('/api/orgs'))
  expect(orgsRes.ok()).toBeTruthy()
  const orgs = await orgsRes.json()
  expect(Array.isArray(orgs)).toBe(true)
  expect(orgs.length).toBeGreaterThan(0)
  orgId = orgs[0].id
})

test.afterAll(async () => {
  await ctx.dispose()
})

/** Ingest one CompetitorCreative row into the shared user's org and return its id. */
async function ingestCompetitorCreative(): Promise<string> {
  const externalId = `remix-jobs-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const body = JSON.stringify(sampleBatch(externalId))
  const s = sign(INGEST_SECRET, body)
  const res = await ctx.post(p(`/api/ingest/competitor?org=${orgId}`), {
    headers: { 'content-type': 'application/json', 'x-adex-timestamp': s.timestamp, 'x-adex-signature': s.signature },
    data: body,
  })
  expect(res.status(), await res.text()).toBe(200)
  const json = await res.json()
  expect(json.created).toBeGreaterThan(0)

  const listRes = await ctx.get(p('/api/competitors'))
  expect(listRes.ok()).toBeTruthy()
  const listJson = await listRes.json()
  const rows: Array<{ id: string; externalId: string }> = listJson.competitors ?? listJson
  const row = rows.find((r) => r.externalId === externalId)
  expect(row, `expected to find ingested row ${externalId}`).toBeTruthy()
  return row!.id
}

async function createRemixJob(competitorCreativeId: string) {
  const res = await ctx.post(p('/api/creatives/remix-jobs'), {
    data: { competitorCreativeId, ...REMIX_PRODUCT },
  })
  return res
}

test.describe('creatives/remix-jobs — control plane', () => {
  test('creates a pending job with a storyboard brief and a review-gated creative', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const res = await createRemixJob(competitorCreativeId)
    expect(res.status(), await res.text()).toBe(200)
    const json = await res.json()

    expect(json.job.status).toBe('pending')
    expect(json.job.tier).toBe('t0_5')
    expect(Array.isArray(json.brief.storyboard)).toBe(true)
    expect(json.brief.storyboard.length).toBeGreaterThan(0)
    expect(json.creative.reviewStatus).toBe('pending')
    expect(json.creative.status).toBe('generating')
  })

  test('rejects unsupported tiers with 400', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const res = await ctx.post(p('/api/creatives/remix-jobs'), {
      data: { competitorCreativeId, tier: 't1', ...REMIX_PRODUCT },
    })
    expect(res.status()).toBe(400)
  })
})

test.describe('worker/remix-jobs — claim atomicity', () => {
  test('claim returns the job once, then null on a repeat claim', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const createRes = await createRemixJob(competitorCreativeId)
    expect(createRes.status()).toBe(200)
    const { job } = await createRes.json()

    const body1 = JSON.stringify({ jobId: job.id })
    const s1 = sign(WORKER_SECRET, body1)
    const claim1 = await ctx.post(p('/api/worker/remix-jobs/claim'), {
      headers: { 'content-type': 'application/json', 'x-adex-timestamp': s1.timestamp, 'x-adex-signature': s1.signature },
      data: body1,
    })
    expect(claim1.status(), await claim1.text()).toBe(200)
    const claim1Json = await claim1.json()
    expect(claim1Json.job).toBeTruthy()
    expect(claim1Json.job.id).toBe(job.id)

    const body2 = JSON.stringify({ jobId: job.id })
    const s2 = sign(WORKER_SECRET, body2)
    const claim2 = await ctx.post(p('/api/worker/remix-jobs/claim'), {
      headers: { 'content-type': 'application/json', 'x-adex-timestamp': s2.timestamp, 'x-adex-signature': s2.signature },
      data: body2,
    })
    expect(claim2.status()).toBe(200)
    const claim2Json = await claim2.json()
    expect(claim2Json.job).toBeNull()
  })

  test('bad signature → 401', async () => {
    const body = JSON.stringify({})
    const res = await ctx.post(p('/api/worker/remix-jobs/claim'), {
      headers: {
        'content-type': 'application/json',
        'x-adex-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-adex-signature': 'sha256=deadbeef',
      },
      data: body,
    })
    expect(res.status()).toBe(401)
  })
})

test.describe('worker/remix-jobs — report', () => {
  test('running report round-trips status + beats via GET ?id=', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const createRes = await createRemixJob(competitorCreativeId)
    const { job } = await createRes.json()

    const beats = [{ index: 0, role: 'hook', status: 'done', seconds: 3 }]
    const reportBody = JSON.stringify({ jobId: job.id, status: 'running', beats })
    const rs = sign(WORKER_SECRET, reportBody)
    const reportRes = await ctx.post(p('/api/worker/remix-jobs/report'), {
      headers: { 'content-type': 'application/json', 'x-adex-timestamp': rs.timestamp, 'x-adex-signature': rs.signature },
      data: reportBody,
    })
    expect(reportRes.status(), await reportRes.text()).toBe(200)

    const getRes = await ctx.get(p(`/api/creatives/remix-jobs?id=${job.id}`))
    expect(getRes.status()).toBe(200)
    const getJson = await getRes.json()
    expect(getJson.job.status).toBe('running')
    expect(getJson.job.beats).toEqual(beats)
  })

  test('succeeded report requires outputUrl, then promotes the linked creative to ready', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const createRes = await createRemixJob(competitorCreativeId)
    const { job } = await createRes.json()

    // Missing outputUrl → 400
    const missingBody = JSON.stringify({ jobId: job.id, status: 'succeeded' })
    const ms = sign(WORKER_SECRET, missingBody)
    const missingRes = await ctx.post(p('/api/worker/remix-jobs/report'), {
      headers: { 'content-type': 'application/json', 'x-adex-timestamp': ms.timestamp, 'x-adex-signature': ms.signature },
      data: missingBody,
    })
    expect(missingRes.status()).toBe(400)

    const outputUrl = `https://storage.googleapis.com/adex-data-gameclaw/uploads/remix/${orgId}/${job.id}.mp4`
    const okBody = JSON.stringify({ jobId: job.id, status: 'succeeded', outputUrl })
    const os = sign(WORKER_SECRET, okBody)
    const okRes = await ctx.post(p('/api/worker/remix-jobs/report'), {
      headers: { 'content-type': 'application/json', 'x-adex-timestamp': os.timestamp, 'x-adex-signature': os.signature },
      data: okBody,
    })
    expect(okRes.status(), await okRes.text()).toBe(200)

    const getRes = await ctx.get(p(`/api/creatives/remix-jobs?id=${job.id}`))
    const getJson = await getRes.json()
    expect(getJson.job.status).toBe('succeeded')
    expect(getJson.job.creative.status).toBe('ready')
    expect(getJson.job.creative.fileUrl).toBe(outputUrl)
  })
})

test.describe('worker/remix-jobs — upload', () => {
  test('bad signature → 401 (happy-path upload not exercised — local GCS IAM is read-only)', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const createRes = await createRemixJob(competitorCreativeId)
    const { job } = await createRes.json()

    const fakeVideo = Buffer.from('not-really-an-mp4')
    const res = await ctx.post(p(`/api/worker/remix-jobs/upload?jobId=${job.id}`), {
      headers: {
        'content-type': 'video/mp4',
        'x-adex-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-adex-content-sha256': 'deadbeef',
        'x-adex-signature': 'sha256=deadbeef',
      },
      data: fakeVideo,
    })
    expect(res.status()).toBe(401)
  })
})
