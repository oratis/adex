/**
 * POST /api/ingest/competitor + GET /api/competitors — happy path, HMAC
 * rejection, and idempotent upsert. Uses the register→login programmatic
 * pattern from .claude/rules/testing.md (no direct DB fixture setup —
 * importing the generated Prisma client from an e2e spec file doesn't play
 * well with Playwright's ESM test loader). Ingest auth uses the
 * `INGEST_WEBHOOK_SECRET` env fallback (see
 * src/app/api/ingest/competitor/route.ts) configured in
 * playwright.config.ts's webServer.env, so no PlatformAuth row is needed.
 *
 * Ref: docs/growth/09-pipeline-adex-integration.md §3
 */
import { test, expect, APIRequestContext } from '@playwright/test'
import crypto from 'node:crypto'

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''
const p = (path: string) => `${BASE_PATH}${path.startsWith('/') ? path : '/' + path}`

// Must match playwright.config.ts webServer.env.INGEST_WEBHOOK_SECRET.
const INGEST_SECRET = 'e2e-competitor-ingest-secret'

function signHmac(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}:${rawBody}`).digest('hex')}`
  return { timestamp: String(timestamp), signature }
}

// Register ONE user for the whole describe. The register endpoint is rate-
// limited to 5/hour/IP, so registering per-test (× retries × reruns against a
// reused dev server) flakes; the authed tests share this one context.
let authed: APIRequestContext
let orgId: string
const suffix = crypto.randomBytes(6).toString('hex')

test.describe('competitor intel ingest', () => {
  test.beforeAll(async ({ playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL
    authed = await playwright.request.newContext({ baseURL })
    const email = `e2e-competitor-${suffix}@adex.test`
    const password = 'e2e-test-password-1234'

    const reg = await authed.post(p('/api/auth/register'), {
      data: { email, password, name: 'E2E Competitor Tester' },
    })
    expect(reg.ok(), `register failed: ${reg.status()} ${await reg.text()}`).toBe(true)

    const login = await authed.post(p('/api/auth/login'), { data: { email, password } })
    expect(login.ok(), `login failed: ${login.status()} ${await login.text()}`).toBe(true)

    const orgsRes = await authed.get(p('/api/orgs'))
    expect(orgsRes.ok()).toBe(true)
    const orgs = await orgsRes.json()
    expect(Array.isArray(orgs) && orgs.length).toBeTruthy()
    orgId = orgs[0].id as string
  })

  test.afterAll(async () => {
    await authed?.dispose()
  })

  test('rejects a request with a bad HMAC signature', async () => {
    const body = JSON.stringify({ externalId: `bad-sig-${crypto.randomBytes(4).toString('hex')}` })
    const res = await authed.post(p(`/api/ingest/competitor?org=${orgId}`), {
      headers: {
        'content-type': 'application/json',
        'x-adex-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-adex-signature': 'sha256=deadbeef',
      },
      data: body,
    })
    expect(res.status()).toBe(401)
  })

  test('ingests a competitor creative and upserts idempotently by externalId', async () => {
    const externalId = `appgrowing-${suffix}-1`
    const payload = {
      externalId,
      appName: 'Puzzle Quest',
      advertiser: 'Acme Games',
      mediaPlatforms: ['google_ads', 'meta'],
      adFormat: 'video',
      region: 'US',
      language: 'en',
      adDays: 42,
      impressions: 1_500_000,
      ratio: '9:16',
      duration: 15,
      sellingPoints: ['fast matches', 'daily rewards'],
      aiPrompt: 'cheerful mobile puzzle ad, bright colors',
    }
    const rawBody = JSON.stringify(payload)
    const { timestamp, signature } = signHmac(INGEST_SECRET, rawBody)

    const res1 = await authed.post(p(`/api/ingest/competitor?org=${orgId}`), {
      headers: {
        'content-type': 'application/json',
        'x-adex-timestamp': timestamp,
        'x-adex-signature': signature,
      },
      data: rawBody,
    })
    expect(res1.ok(), `ingest failed: ${res1.status()} ${await res1.text()}`).toBe(true)
    const json1 = await res1.json()
    expect(json1.ok).toBe(true)
    expect(json1.results).toHaveLength(1)
    expect(json1.results[0]).toMatchObject({ externalId, status: 'created' })

    // Re-ingest the same externalId — should update, not duplicate.
    const rawBody2 = JSON.stringify({ ...payload, adDays: 43 })
    const sig2 = signHmac(INGEST_SECRET, rawBody2)
    const res2 = await authed.post(p(`/api/ingest/competitor?org=${orgId}`), {
      headers: {
        'content-type': 'application/json',
        'x-adex-timestamp': sig2.timestamp,
        'x-adex-signature': sig2.signature,
      },
      data: rawBody2,
    })
    expect(res2.ok()).toBe(true)
    const json2 = await res2.json()
    expect(json2.results[0]).toMatchObject({ externalId, status: 'updated' })

    // GET /api/competitors — same authed context (cookie persists) — should
    // list exactly one row for this externalId, and reflect the update.
    const list = await authed.get(p(`/api/competitors?appName=Puzzle`))
    expect(list.ok()).toBe(true)
    const rows = await list.json()
    const matches = (rows as Array<{ externalId: string; adDays: number | null }>).filter(
      (r) => r.externalId === externalId,
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].adDays).toBe(43)
  })

  test('GET /api/competitors requires a logged-in session', async ({ request }) => {
    // The default `request` fixture is unauthenticated and honours the config
    // baseURL — no hardcoded host, no shared cookies.
    const res = await request.get(p('/api/competitors'))
    expect(res.status()).toBe(401)
  })
})
