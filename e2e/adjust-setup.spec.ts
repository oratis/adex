import crypto from 'node:crypto'
import http from 'node:http'
import pg from 'pg'
import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
} from '@playwright/test'

const p = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}${path}`
test('Adjust endpoints reject anonymous access before contacting a provider', async ({
  request,
}) => {
  for (const endpoint of [
    '/api/adjust',
    '/api/adjust/catalog',
    '/api/adjust/reports?appToken=luddi',
  ]) {
    expect((await request.get(p(endpoint))).status()).toBe(401)
  }
  expect(
    (
      await request.post(p('/api/adjust'), { data: { token: 'fixture' } })
    ).status(),
  ).toBe(401)
})
test.describe('Adjust setup with a real isolated database and local HTTP provider', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(
    !process.env.DATABASE_URL ||
      process.env.REPORT_DB_TESTS !== '1' ||
      process.env.ADJUST_TEST_API_URL !== 'http://127.0.0.1:3322',
    'requires isolated DB and local Adjust fixture',
  )
  let ctx: APIRequestContext
  let pool: pg.Pool
  let orgId: string
  let failing = false
  let calls = 0
  const server = http.createServer((req, res) => {
    calls++
    const url = new URL(req.url!, 'http://127.0.0.1:3322')
    res.setHeader('Content-Type', 'application/json')
    if (failing) {
      res.statusCode = 503
      res.end('{"message":"fixture unavailable"}')
      return
    }
    const app = url.searchParams.get('app_token__in')
    if (url.pathname === '/filters_data')
      res.end(
        JSON.stringify({
          apps: [
            { id: 'luddi', name: 'Luddi' },
            { id: 'cuddler', name: 'Cuddler' },
          ],
        }),
      )
    else if (url.pathname === '/events')
      res.end(
        JSON.stringify([
          {
            id: `${app}_signup`,
            name: 'Registration',
            app_token: [app],
            is_skad_event: false,
          },
        ]),
      )
    else
      res.end(
        JSON.stringify({
          rows:
            url.searchParams.get('dimensions') === 'app_token'
              ? [{ app_token: app, installs: '10', [`${app}_signup`]: '4' }]
              : [
                  {
                    app_token: app,
                    network: 'Organic',
                    partner: 'Organic',
                    installs: '6',
                    [`${app}_signup`]: '3',
                  },
                  {
                    app_token: app,
                    partner: 'facebook',
                    network: 'Facebook Installs',
                    campaign_id_network: '123',
                    installs: '4',
                    [`${app}_signup`]: '1',
                  },
                ],
          pagination: null,
        }),
      )
  })
  const plan = (app: string) => ({
    version: 1,
    appToken: app,
    appName: app,
    productId: null,
    currency: 'USD',
    utcOffset: '+00:00',
    attributionSource: 'first',
    reattributed: 'false',
    autoSync: false,
    metricsConfirmed: true,
    metrics: {
      registration: {
        id: `${app}_signup`,
        name: 'Registration',
        kind: 'events',
      },
    },
    sourceRules: [],
  })
  test.beforeAll(async ({}, info) => {
    await new Promise<void>((resolve) =>
      server.listen(3322, '127.0.0.1', resolve),
    )
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    ctx = await pwRequest.newContext({ baseURL: info.project.use.baseURL })
    const suffix = crypto.randomUUID()
    expect(
      (
        await ctx.post(p('/api/auth/register'), {
          data: {
            email: `adjust-${suffix}@adex-e2e.dev`,
            password: 'fixture-password-1',
            name: `Adjust ${suffix.slice(0, 8)}`,
          },
        })
      ).ok(),
    ).toBeTruthy()
    const org = await ctx.post(p('/api/orgs'), {
      data: { name: `Adjust ${suffix}` },
    })
    orgId = (await org.json()).id
    expect(
      (await ctx.post(p('/api/orgs/switch'), { data: { orgId } })).ok(),
    ).toBeTruthy()
  })
  test.afterAll(async () => {
    await pool?.end()
    await ctx?.dispose()
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  test('an existing user ID is not accepted as a session credential', async ({
    request,
  }) => {
    const { rows } = await pool.query(
      'SELECT "userId" FROM "OrgMembership" WHERE "orgId"=$1',
      [orgId],
    )
    const before = calls
    const response = await request.get(p('/api/adjust'), {
      headers: { Cookie: `auth_token=${rows[0].userId}` },
    })
    expect(response.status()).toBe(401)
    expect(calls).toBe(before)
  })
  test('connects once without returning or storing a plaintext token', async () => {
    const res = await ctx.post(p('/api/adjust'), {
      data: { token: 'fixture-not-a-real-token' },
    })
    expect(res.status()).toBe(200)
    expect(await res.text()).not.toContain('fixture-not-a-real-token')
    const { rows } = await pool.query(
      'SELECT "apiKey" FROM "PlatformAuth" WHERE "orgId"=$1 AND platform=\'adjust\'',
      [orgId],
    )
    expect(rows[0].apiKey).toMatch(/^enc:v1:/)
    for (const endpoint of ['/api/platforms', '/api/adjust'])
      expect(await (await ctx.get(p(endpoint))).text()).not.toContain(
        rows[0].apiKey,
      )
  })
  test('discovers two apps and rejects cross-app event mappings', async () => {
    expect(
      (await (await ctx.get(p('/api/adjust/catalog'))).json()).apps,
    ).toHaveLength(2)
    const wrong = { ...plan('luddi'), metrics: plan('cuddler').metrics }
    expect(
      (await ctx.put(p('/api/adjust'), { data: { plan: wrong } })).status(),
    ).toBe(400)
  })
  test('previews, saves and synchronizes each app without multiplying rows', async () => {
    for (const app of ['luddi', 'cuddler']) {
      const preview = await ctx.post(p('/api/adjust/reports'), {
        data: {
          plan: plan(app),
          startDate: '2026-09-01',
          endDate: '2026-09-07',
        },
      })
      expect(preview.status()).toBe(200)
      expect(
        (await preview.json()).data.rows.map(
          (row: { traffic: string }) => row.traffic,
        ),
      ).toEqual(['organic', 'paid'])
      expect(
        (
          await ctx.put(p('/api/adjust'), { data: { plan: plan(app) } })
        ).status(),
      ).toBe(200)
      for (let i = 0; i < 2; i++)
        expect(
          (
            await ctx.put(p('/api/adjust/reports'), {
              data: {
                appToken: app,
                startDate: '2026-09-01',
                endDate: '2026-09-07',
              },
            })
          ).status(),
        ).toBe(200)
    }
    const { rows } = await pool.query(
      'SELECT count(*)::int AS count FROM "AdjustReportSnapshot" WHERE "orgId"=$1',
      [orgId],
    )
    expect(rows[0].count).toBe(2)
  })
  test('provider failure preserves the previous successful snapshot', async () => {
    const before = await (
      await ctx.get(p('/api/adjust/reports?appToken=luddi'))
    ).json()
    failing = true
    const response = await ctx.put(p('/api/adjust/reports'), {
      data: {
        appToken: 'luddi',
        startDate: '2026-09-01',
        endDate: '2026-09-07',
      },
    })
    failing = false
    expect(response.status()).toBe(502)
    expect(
      await (await ctx.get(p('/api/adjust/reports?appToken=luddi'))).json(),
    ).toEqual(before)
  })
  test('saved reports remain readable when event discovery is unavailable', async ({
    page,
  }, info) => {
    await page.context().addCookies((await ctx.storageState()).cookies)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(p('/settings/adjust'))
    await page
      .getByLabel('Adjust 应用', { exact: true })
      .selectOption('cuddler')
    await expect(
      page.getByRole('heading', { name: 'cuddler / 报表' }),
    ).toBeVisible()
    await page.getByLabel('UTC 偏移', { exact: true }).fill(' +00:00 ')
    await page.getByRole('button', { name: '预览', exact: true }).click()
    await expect(page.getByLabel('UTC 偏移', { exact: true })).toHaveValue(
      '+00:00',
    )
    await expect(
      page.getByRole('button', { name: '保存并同步', exact: true }),
    ).toBeEnabled()
    failing = true
    try {
      await page
        .getByLabel('Adjust 应用', { exact: true })
        .selectOption('luddi')
      await expect(
        page.getByRole('heading', { name: 'luddi / 报表' }),
      ).toBeVisible()
      await expect(page.getByRole('main').getByRole('alert')).toContainText(
        'Adjust request failed',
      )
      await expect(page.getByLabel('注册指标', { exact: true })).toHaveValue(
        'luddi_signup',
      )
      await expect(
        page
          .locator('option:checked')
          .filter({ hasText: 'Registration / luddi_signup' }),
      ).toHaveCount(1)
      await page.screenshot({
        path: info.outputPath('adjust-desktop.png'),
        fullPage: true,
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await expect
        .poll(() =>
          page.getByRole('complementary').evaluate(
            (element) => element.getBoundingClientRect().right,
          ),
        )
        .toBeLessThanOrEqual(0)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390)
      await page.screenshot({
        path: info.outputPath('adjust-mobile.png'),
        fullPage: true,
      })
    } finally {
      failing = false
    }
  })
  test('configuration changes mark the prior snapshot stale until refreshed', async () => {
    const changed = {
      ...plan('luddi'),
      sourceRules: [
        {
          network: 'Facebook Installs',
          partner: 'facebook',
          traffic: 'other',
          platform: 'meta',
        },
      ],
    }
    expect(
      (await ctx.put(p('/api/adjust'), { data: { plan: changed } })).status(),
    ).toBe(200)
    const stale = await (
      await ctx.get(p('/api/adjust/reports?appToken=luddi'))
    ).json()
    expect(stale.stale).toBe(true)
    expect(stale.data.rows[1].traffic).toBe('paid')
    const synced = await ctx.put(p('/api/adjust/reports'), {
      data: {
        appToken: 'luddi',
        startDate: '2026-09-01',
        endDate: '2026-09-07',
      },
    })
    expect((await synced.json()).data.rows[1].traffic).toBe('other')
  })
  test('members can read but cannot trigger Adjust writes through either sync entry', async () => {
    await pool.query(
      'UPDATE "OrgMembership" SET role=\'member\' WHERE "orgId"=$1',
      [orgId],
    )
    const before = calls
    try {
      expect(
        (await ctx.get(p('/api/adjust/reports?appToken=luddi'))).status(),
      ).toBe(200)
      expect(
        (
          await ctx.put(p('/api/adjust/reports'), {
            data: {
              appToken: 'luddi',
              startDate: '2026-09-01',
              endDate: '2026-09-07',
            },
          })
        ).status(),
      ).toBe(403)
      const combined = await ctx.post(p('/api/reports/sync'))
      expect(combined.status()).toBe(200)
      expect((await combined.json()).results.adjust.error).toBe(
        'Workspace admin access required',
      )
      for (const endpoint of ['/api/platforms', '/api/platforms/accounts']) {
        for (const data of [
          {},
          { platform: { not: 'unknown' }, accountId: { not: 'unknown' } },
        ]) {
          expect((await ctx.delete(p(endpoint), { data })).status()).toBe(400)
        }
        expect(
          (
            await ctx.delete(p(endpoint), {
              data: { platform: 'adjust', accountId: 'luddi' },
            })
          ).status(),
        ).toBe(403)
      }
      expect(
        (await ctx.get(p('/api/adjust/reports?appToken=luddi'))).status(),
      ).toBe(200)
      expect((await (await ctx.get(p('/api/adjust'))).json()).connected).toBe(
        true,
      )
      expect(calls).toBe(before)
    } finally {
      await pool.query(
        'UPDATE "OrgMembership" SET role=\'owner\' WHERE "orgId"=$1',
        [orgId],
      )
    }
  })
  test('a different workspace cannot read or sync this connection', async () => {
    const other = await ctx.post(p('/api/orgs'), {
      data: { name: 'Other Adjust workspace' },
    })
    await ctx.post(p('/api/orgs/switch'), {
      data: { orgId: (await other.json()).id },
    })
    const before = calls
    expect(
      (await ctx.get(p('/api/adjust/reports?appToken=luddi'))).status(),
    ).toBe(404)
    expect(
      (
        await ctx.put(p('/api/adjust/reports'), {
          data: {
            appToken: 'luddi',
            startDate: '2026-09-01',
            endDate: '2026-09-07',
          },
        })
      ).status(),
    ).toBe(404)
    expect(calls).toBe(before)
  })
})
