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
import crypto from 'node:crypto'
import pg from 'pg'
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { sign } from './helpers/hmac'

// Every test in this file shares one registered user + session (register is
// 5/hr/IP rate-limited) — run the whole file in a single worker, in order, so
// `beforeAll` only registers once and no two workers race the same account.
test.describe.configure({ mode: 'serial' })

// Same convention as competitor-ingest.spec.ts: upstream CI runs the web server
// with no DATABASE_URL and an invite-gated register endpoint, so DB-backed specs
// self-skip unless the runner env opts in (set both secrets against a live
// Postgres, matching playwright.config.ts webServer.env). File-scope skip so the
// registration `beforeAll` never runs either.
test.skip(
  !process.env.INGEST_WEBHOOK_SECRET || !process.env.WORKER_WEBHOOK_SECRET,
  'requires INGEST_WEBHOOK_SECRET + WORKER_WEBHOOK_SECRET in the runner env (live Postgres)',
)

// The t1/t2 refs tests below need to hand-insert an Asset row and point a
// CompetitorCreative at it — there's no hermetic HTTP path to do this (the
// real Tier-2 "Save video" flow at /api/competitors/media fetches the source
// URL over the network). Attempting the spec's original plan — importing the
// generated Prisma client (src/generated/prisma/client) from an e2e spec —
// hits a hard CJS/ESM incompatibility: that file assumes ESM (top-level
// `import.meta.url`) but Playwright's test transform loads it as CommonJS,
// so `node:pg` (a plain CJS package, no bundler-specific output) is used for
// direct SQL instead. Same DATABASE_URL as the app; skip gate covers it.
test.skip(!process.env.DATABASE_URL, 'requires DATABASE_URL (direct SQL for the t1/t2 refs tests)')

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''
const p = (path: string) => `${BASE_PATH}${path.startsWith('/') ? path : '/' + path}`

const INGEST_SECRET = process.env.INGEST_WEBHOOK_SECRET || 'e2e-competitor-ingest-secret'
const WORKER_SECRET = process.env.WORKER_WEBHOOK_SECRET || 'e2e-worker-secret'

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
        // NOT `duration` — the payload's `duration` field is a firstSeen~lastSeen
        // date range (src/lib/growth/competitor-import.ts), not the video length.
        // `videoDuration` maps to CompetitorCreative.duration (seconds).
        videoDuration: 24,
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
let userId: string
let pool: pg.Pool

test.beforeAll(async ({}, testInfo) => {
  ctx = await pwRequest.newContext({ baseURL: testInfo.project.use.baseURL })
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `remix-jobs-e2e-${unique}@adex-e2e.dev`
  const res = await ctx.post(p('/api/auth/register'), {
    data: { email, password: 'e2e-test-password-1', name: `Remix Jobs E2E ${unique}` },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  userId = (await res.json()).id

  const orgsRes = await ctx.get(p('/api/orgs'))
  expect(orgsRes.ok()).toBeTruthy()
  const orgs = await orgsRes.json()
  expect(Array.isArray(orgs)).toBe(true)
  expect(orgs.length).toBeGreaterThan(0)
  orgId = orgs[0].id
})

test.afterAll(async () => {
  await pool?.end()
})

/** Direct-SQL insert of an Asset row (see file-header comment for why this bypasses Prisma/HTTP). */
async function insertAsset(opts: { orgId: string; uploadedBy: string; fileUrl: string }): Promise<string> {
  const id = `e2e-asset-${crypto.randomUUID()}`
  await pool.query(
    `INSERT INTO "Asset" (id, "orgId", "uploadedBy", name, type, source, "fileUrl", status, "isFolder", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'E2E asset', 'video', 'upload', $4, 'ready', false, now(), now())`,
    [id, opts.orgId, opts.uploadedBy, opts.fileUrl],
  )
  return id
}

/** Direct-SQL point a CompetitorCreative's assetId at an Asset id. */
async function setCcAssetId(ccId: string, assetId: string): Promise<void> {
  await pool.query(`UPDATE "CompetitorCreative" SET "assetId" = $1 WHERE id = $2`, [assetId, ccId])
}

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

async function createRemixJob(competitorCreativeId: string, extra?: Record<string, unknown>) {
  const res = await ctx.post(p('/api/creatives/remix-jobs'), {
    data: { competitorCreativeId, ...REMIX_PRODUCT, ...extra },
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

  test('rejects unknown tiers with 400', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const res = await ctx.post(p('/api/creatives/remix-jobs'), {
      data: { competitorCreativeId, tier: 't9', ...REMIX_PRODUCT },
    })
    expect(res.status()).toBe(400)
  })

  // t1/t2 gating (Tier-1/2 control-plane opt-in). The e2e webServer runs with
  // REMIX_ENABLED_TIERS="t0_5,t1,t2" (playwright.config.ts) so the 403
  // "not enabled" branch (parseEnabledTiers) can't be exercised end-to-end
  // here — it's covered by reading parseEnabledTiers' default behavior
  // (unset/empty env → {'t0_5'}) plus the route wiring reviewed by hand.
  // These tests instead cover the two 400 gates that DO run with all tiers
  // open: t2's segmentPlan requirement, and both tiers' "video must already
  // be stored via Tier-2 Save video" requirement.
  test('t2 with a malformed segmentPlan (negative start / overlap) → 400', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    for (const bad of [
      [{ start: -10, end: 5, action: 'reuse' }],
      [
        { start: 0, end: 5, action: 'reuse' },
        { start: 3, end: 8, action: 'reuse' },
      ],
    ]) {
      const res = await ctx.post(p('/api/creatives/remix-jobs'), {
        data: { competitorCreativeId, tier: 't2', segmentPlan: bad, ...REMIX_PRODUCT },
      })
      expect(res.status(), JSON.stringify(bad)).toBe(400)
    }
  })

  test('t2 without a segmentPlan → 400', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const res = await ctx.post(p('/api/creatives/remix-jobs'), {
      data: { competitorCreativeId, tier: 't2', ...REMIX_PRODUCT },
    })
    expect(res.status()).toBe(400)
  })

  test('t2 with a valid segmentPlan but no stored competitor video → 400 "Save video"', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const res = await ctx.post(p('/api/creatives/remix-jobs'), {
      data: {
        competitorCreativeId,
        tier: 't2',
        segmentPlan: [{ start: 0, end: 3, action: 'reuse', description: 'hook' }],
        ...REMIX_PRODUCT,
      },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Save video')
  })

  test('t1 with no stored competitor video → 400 "Save video"', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const res = await ctx.post(p('/api/creatives/remix-jobs'), {
      data: { competitorCreativeId, tier: 't1', ...REMIX_PRODUCT },
    })
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Save video')
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
    expect(typeof claim1Json.job.claimToken).toBe('string')
    expect(claim1Json.job.claimToken.length).toBeGreaterThan(0)
    expect(claim1Json.job.attempt).toBe(1)

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

/** Sign + POST a worker request; returns the raw Playwright response. */
async function workerPost(path: string, secret: string, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload)
  const s = sign(secret, body)
  return ctx.post(p(path), {
    headers: { 'content-type': 'application/json', 'x-adex-timestamp': s.timestamp, 'x-adex-signature': s.signature },
    data: body,
  })
}

/** Claim a job by id — asserts success and returns the response body's job. */
async function claimJob(jobId: string) {
  const res = await workerPost('/api/worker/remix-jobs/claim', WORKER_SECRET, { jobId })
  expect(res.status(), await res.text()).toBe(200)
  const json = await res.json()
  expect(json.job).toBeTruthy()
  return json.job
}

function canonicalOutputUrl(jobId: string, attempt: number) {
  return `https://storage.googleapis.com/adex-data-gameclaw/uploads/remix/${orgId}/${jobId}/v${attempt}.mp4`
}

/** Create + claim a job, then drive it through running→assembling→qc (all legal). */
async function createClaimedJobAtQc() {
  const competitorCreativeId = await ingestCompetitorCreative()
  const createRes = await createRemixJob(competitorCreativeId)
  const { job } = await createRes.json()
  const claimed = await claimJob(job.id)
  for (const status of ['running', 'assembling', 'qc']) {
    const res = await workerPost('/api/worker/remix-jobs/report', WORKER_SECRET, {
      jobId: job.id,
      claimToken: claimed.claimToken,
      status,
    })
    expect(res.status(), await res.text()).toBe(200)
  }
  return { id: job.id as string, claimToken: claimed.claimToken as string, attempt: claimed.attempt as number }
}

test.describe('worker/remix-jobs — report', () => {
  test('running report round-trips status + beats via GET ?id=', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const createRes = await createRemixJob(competitorCreativeId)
    const { job } = await createRes.json()
    const claimed = await claimJob(job.id)

    const beats = [{ index: 0, role: 'hook', status: 'done', seconds: 3 }]
    const reportRes = await workerPost('/api/worker/remix-jobs/report', WORKER_SECRET, {
      jobId: job.id,
      claimToken: claimed.claimToken,
      status: 'running',
      beats,
    })
    expect(reportRes.status(), await reportRes.text()).toBe(200)

    const getRes = await ctx.get(p(`/api/creatives/remix-jobs?id=${job.id}`))
    expect(getRes.status()).toBe(200)
    const getJson = await getRes.json()
    expect(getJson.job.status).toBe('running')
    expect(getJson.job.beats).toEqual(beats)
  })

  test('succeeded report requires outputUrl, then promotes the linked creative to ready via the legal running→assembling→qc→succeeded sequence', async () => {
    const job = await createClaimedJobAtQc()

    // Missing outputUrl → 400 (checked before the transition, regardless of current status)
    const missingRes = await workerPost('/api/worker/remix-jobs/report', WORKER_SECRET, {
      jobId: job.id,
      claimToken: job.claimToken,
      status: 'succeeded',
    })
    expect(missingRes.status()).toBe(400)

    const outputUrl = canonicalOutputUrl(job.id, job.attempt)
    const okRes = await workerPost('/api/worker/remix-jobs/report', WORKER_SECRET, {
      jobId: job.id,
      claimToken: job.claimToken,
      status: 'succeeded',
      outputUrl,
    })
    expect(okRes.status(), await okRes.text()).toBe(200)

    const getRes = await ctx.get(p(`/api/creatives/remix-jobs?id=${job.id}`))
    const getJson = await getRes.json()
    expect(getJson.job.status).toBe('succeeded')
    expect(getJson.job.creative.status).toBe('ready')
    expect(getJson.job.creative.fileUrl).toBe(outputUrl)
  })

  test('report after succeeded (terminal) → 409', async () => {
    const job = await createClaimedJobAtQc()
    const outputUrl = canonicalOutputUrl(job.id, job.attempt)
    const okRes = await workerPost('/api/worker/remix-jobs/report', WORKER_SECRET, {
      jobId: job.id,
      claimToken: job.claimToken,
      status: 'succeeded',
      outputUrl,
    })
    expect(okRes.status(), await okRes.text()).toBe(200)

    const afterRes = await workerPost('/api/worker/remix-jobs/report', WORKER_SECRET, {
      jobId: job.id,
      claimToken: job.claimToken,
      status: 'running',
    })
    expect(afterRes.status()).toBe(409)
    const afterJson = await afterRes.json()
    expect(afterJson.currentStatus).toBe('succeeded')
  })

  test('succeeded report on an unclaimed pending job → 409', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const createRes = await createRemixJob(competitorCreativeId)
    const { job } = await createRes.json()

    const outputUrl = canonicalOutputUrl(job.id, 0)
    const res = await workerPost('/api/worker/remix-jobs/report', WORKER_SECRET, {
      jobId: job.id,
      claimToken: 'irrelevant-token-job-was-never-claimed',
      status: 'succeeded',
      outputUrl,
    })
    expect(res.status()).toBe(409)
    const json = await res.json()
    expect(json.currentStatus).toBe('pending')
  })

  test('succeeded report with a non-canonical outputUrl → 400', async () => {
    const job = await createClaimedJobAtQc()
    const badUrl = 'https://storage.googleapis.com/adex-data-gameclaw/uploads/remix/some-other-org/some-other-job/v1.mp4'
    const res = await workerPost('/api/worker/remix-jobs/report', WORKER_SECRET, {
      jobId: job.id,
      claimToken: job.claimToken,
      status: 'succeeded',
      outputUrl: badUrl,
    })
    expect(res.status()).toBe(400)
  })

  test('succeeded report with qcReport pass:false still promotes the creative, but flags reviewNotes', async () => {
    const job = await createClaimedJobAtQc()
    const outputUrl = canonicalOutputUrl(job.id, job.attempt)
    const qcReport = { pass: false, hits: [{ term: 'competitor-name', beat: 0 }] }
    const res = await workerPost('/api/worker/remix-jobs/report', WORKER_SECRET, {
      jobId: job.id,
      claimToken: job.claimToken,
      status: 'succeeded',
      outputUrl,
      qcReport,
    })
    expect(res.status(), await res.text()).toBe(200)

    const getRes = await ctx.get(p(`/api/creatives/remix-jobs?id=${job.id}`))
    const getJson = await getRes.json()
    expect(getJson.job.creative.status).toBe('ready')
    expect(getJson.job.creative.reviewNotes).toContain('QC FAILED')
  })

  test('report with a wrong claimToken → 409 stale claim', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const createRes = await createRemixJob(competitorCreativeId)
    const { job } = await createRes.json()
    await claimJob(job.id)

    const res = await workerPost('/api/worker/remix-jobs/report', WORKER_SECRET, {
      jobId: job.id,
      claimToken: 'not-the-real-claim-token',
      status: 'running',
    })
    expect(res.status(), await res.text()).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('stale claim')
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
        'x-adex-claim-token': 'whatever',
        'x-adex-signature': 'sha256=deadbeef',
      },
      data: fakeVideo,
    })
    expect(res.status()).toBe(401)
  })

  test('missing x-adex-claim-token → 401', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const createRes = await createRemixJob(competitorCreativeId)
    const { job } = await createRes.json()
    const claimed = await claimJob(job.id)

    const fakeVideo = Buffer.from('not-really-an-mp4')
    const contentSha256 = crypto.createHash('sha256').update(fakeVideo).digest('hex')
    const s = sign(WORKER_SECRET, `${job.id}:${claimed.claimToken}:${contentSha256}`)
    const res = await ctx.post(p(`/api/worker/remix-jobs/upload?jobId=${job.id}`), {
      headers: {
        'content-type': 'video/mp4',
        'x-adex-timestamp': s.timestamp,
        'x-adex-content-sha256': contentSha256,
        'x-adex-signature': s.signature,
        // x-adex-claim-token intentionally omitted
      },
      data: fakeVideo,
    })
    expect(res.status()).toBe(401)
  })

  test('wrong claimToken (signature correctly computed over the wrong token) → 409', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const createRes = await createRemixJob(competitorCreativeId)
    const { job } = await createRes.json()
    await claimJob(job.id)

    const fakeVideo = Buffer.from('not-really-an-mp4')
    const contentSha256 = crypto.createHash('sha256').update(fakeVideo).digest('hex')
    const wrongToken = 'wrong-claim-token'
    const s = sign(WORKER_SECRET, `${job.id}:${wrongToken}:${contentSha256}`)
    const res = await ctx.post(p(`/api/worker/remix-jobs/upload?jobId=${job.id}`), {
      headers: {
        'content-type': 'video/mp4',
        'x-adex-timestamp': s.timestamp,
        'x-adex-content-sha256': contentSha256,
        'x-adex-claim-token': wrongToken,
        'x-adex-signature': s.signature,
      },
      data: fakeVideo,
    })
    expect(res.status(), await res.text()).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('stale claim')
  })
})

// t1/t2 refs — the worker-side @reference (t1) / clean-segment source (t2)
// resolved from CompetitorCreative.assetId → Asset.fileUrl at claim time. No
// hermetic HTTP path creates a stored Asset (the real Tier-2 "Save video" flow
// fetches over the network), so these insert the Asset row directly via SQL —
// see the file-header comment above the DATABASE_URL skip gate.
test.describe('worker/remix-jobs — t1/t2 refs (direct-SQL Asset)', () => {
  test('t2 claim returns refs pointing at the org-scoped stored Asset', async () => {
    const competitorCreativeId = await ingestCompetitorCreative()
    const fileUrl = 'https://storage.googleapis.com/adex-data-gameclaw/uploads/e2e-test-asset.mp4'
    const assetId = await insertAsset({ orgId, uploadedBy: userId, fileUrl })
    await setCcAssetId(competitorCreativeId, assetId)

    const createRes = await createRemixJob(competitorCreativeId, {
      tier: 't2',
      segmentPlan: [{ start: 0, end: 5, action: 'reuse' }],
    })
    expect(createRes.status(), await createRes.text()).toBe(200)
    const { job } = await createRes.json()

    const claimed = await claimJob(job.id)
    expect(claimed.claimToken).toBeTruthy()
    expect(claimed.refs).toEqual([{ url: fileUrl, kind: 'video' }])
  })

  test("org isolation (regression, bbf02d4): claim never leaks another org's Asset via a foreign assetId", async ({}, testInfo) => {
    // Org A: create a valid t2 job with a real, org-A-scoped Asset — this has
    // to pass the create-time "competitor video not stored" check, which is
    // itself already org-scoped, so the only way to reach the vulnerable
    // pre-fix state is a *later* mutation of assetId (bad import / re-link).
    const competitorCreativeId = await ingestCompetitorCreative()
    const assetA = await insertAsset({
      orgId,
      uploadedBy: userId,
      fileUrl: 'https://storage.googleapis.com/adex-data-gameclaw/uploads/e2e-org-a-asset.mp4',
    })
    await setCcAssetId(competitorCreativeId, assetA)

    const createRes = await createRemixJob(competitorCreativeId, {
      tier: 't2',
      segmentPlan: [{ start: 0, end: 5, action: 'reuse' }],
    })
    expect(createRes.status(), await createRes.text()).toBe(200)
    const { job } = await createRes.json()

    // Org B: an unrelated second user/org, registered in its own request
    // context so it never touches the shared `ctx` session cookie.
    const bCtx = await pwRequest.newContext({ baseURL: testInfo.project.use.baseURL })
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const bRes = await bCtx.post(p('/api/auth/register'), {
      data: {
        email: `remix-jobs-e2e-orgb-${unique}@adex-e2e.dev`,
        password: 'e2e-test-password-1',
        name: `Remix Jobs E2E OrgB ${unique}`,
      },
    })
    expect(bRes.ok(), await bRes.text()).toBeTruthy()
    const bUserId = (await bRes.json()).id
    const bOrgsRes = await bCtx.get(p('/api/orgs'))
    const bOrgs = await bOrgsRes.json()
    const orgBId = bOrgs[0].id
    await bCtx.dispose()

    const assetB = await insertAsset({
      orgId: orgBId,
      uploadedBy: bUserId,
      fileUrl: 'https://storage.googleapis.com/adex-data-gameclaw/uploads/e2e-org-b-asset.mp4',
    })

    // The bug scenario: CompetitorCreative (org A) ends up pointing at a
    // *foreign* org's Asset.
    await setCcAssetId(competitorCreativeId, assetB)

    const claimed = await claimJob(job.id)
    expect(claimed.refs).toEqual([])
  })
})
