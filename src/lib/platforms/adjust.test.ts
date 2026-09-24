import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdjustClient } from './adjust'
import { parseAdjustPlan } from '@/lib/reports/adjust-data'

const fetchMock = vi.fn()
const client = new AdjustClient({
  apiToken: 'fixture-not-a-key',
  appToken: 'fixture-app',
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('Adjust report boundary (offline)', () => {
  it('discovers apps and filters events to the selected app, excluding SKAN', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ apps: [{ id: 'fixture-app', name: 'Luddi' }] }),
    )
    expect(await client.listApps()).toEqual([
      { id: 'fixture-app', name: 'Luddi' },
    ])
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'filters_data?required_filters=apps',
    )
    fetchMock.mockResolvedValueOnce(
      Response.json([
        {
          id: 'signup',
          name: 'Signup',
          app_token: ['fixture-app'],
          is_skad_event: false,
        },
        { id: 'wrong', name: 'Other app', app_token: ['another-app'] },
        {
          id: 'skan',
          name: 'SKAN',
          app_token: ['fixture-app'],
          is_skad_event: true,
        },
      ]),
    )
    expect((await client.listEvents()).map((event) => event.id)).toEqual([
      'signup',
    ])
    expect(
      new URL(String(fetchMock.mock.calls[1][0])).searchParams.get(
        'app_token__in',
      ),
    ).toBe('fixture-app')
  })

  it('does not follow redirects with the API credential', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.test' },
      }),
    )
    await expect(client.getReport('2026-09-01', '2026-09-02')).rejects.toThrow(
      'HTTP 302',
    )
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error')
  })

  it('pins app, timezone, currency and attribution while querying whole-window totals separately', async () => {
    const plan = parseAdjustPlan({
      version: 1,
      appToken: 'fixture-app',
      appName: 'Luddi',
      productId: null,
      currency: 'USD',
      utcOffset: '+08:00',
      attributionSource: 'first',
      reattributed: 'false',
      autoSync: false,
      metricsConfirmed: true,
      metrics: {
        registration: { id: 'luddi_signup', name: 'Signup', kind: 'events' },
      },
      sourceRules: [],
    })
    fetchMock.mockResolvedValueOnce(
      Response.json({
        rows: [
          {
            app_token: 'fixture-app',
            network: 'Organic',
            installs: '10',
            luddi_signup: '4',
          },
        ],
      }),
    )
    fetchMock.mockResolvedValueOnce(
      Response.json({
        rows: [{ app_token: 'fixture-app', installs: '10', luddi_signup: '4' }],
      }),
    )
    const result = await client.getMappedReport(
      plan,
      '2026-09-01',
      '2026-09-07',
    )
    expect(result.totals.registration).toBe(4)
    const queries = fetchMock.mock.calls.map(
      (call) => new URL(String(call[0])).searchParams,
    )
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(query.get('app_token__in')).toBe('fixture-app')
      expect(query.get('utc_offset')).toBe('+08:00')
      expect(query.get('currency')).toBe('USD')
      expect(query.get('metrics')).toBe('installs,luddi_signup')
      expect(query.get('attribution_source')).toBe('first')
      expect(query.get('reattributed')).toBe('false')
    }
    expect(queries[1].get('dimensions')).toBe('app_token')
  })

  it('uses the documented JSON endpoint and preserves rows, totals and warnings', async () => {
    const report = {
      rows: [{ day: '2026-09-01', installs: '10', revenue: '25.00' }],
      totals: { installs: 10, revenue: 25 },
      warnings: ['fixture warning'],
    }
    fetchMock.mockResolvedValue(Response.json(report))

    expect(await client.getReport('2026-09-01', '2026-09-02')).toEqual(report)
    const [input, init] = fetchMock.mock.calls[0]
    const url = new URL(String(input))
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://automate.adjust.com/reports-service/report',
    )
    expect(url.searchParams.get('app_token__in')).toBe('fixture-app')
    expect(url.searchParams.get('date_period')).toBe('2026-09-01:2026-09-02')
    expect(url.searchParams.get('dimensions')).toBe('day,app')
    expect(init.headers.Authorization).toBe('Bearer fixture-not-a-key')
  })

  for (const method of ['getReport', 'getCohortReport'] as const) {
    describe(method, () => {
      it.each([401, 403, 429, 503])(
        'rejects HTTP %s instead of returning an empty success',
        async (status) => {
          // Some error bodies do not contain the legacy `error` property.
          fetchMock.mockResolvedValue(
            Response.json({ message: 'provider failure' }, { status }),
          )
          await expect(
            client[method]('2026-09-01', '2026-09-02'),
          ).rejects.toThrow(`Adjust report request failed (HTTP ${status})`)
        },
      )

      it.each([
        null,
        {},
        { rows: null },
        { rows: [null] },
        { rows: [], error: 'rejected' },
      ])('rejects an invalid success envelope: %j', async (body) => {
        fetchMock.mockResolvedValue(Response.json(body))
        await expect(
          client[method]('2026-09-01', '2026-09-02'),
        ).rejects.toThrow('Invalid Adjust report response')
      })

      it('accepts a documented 204 as no rows', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
        await expect(
          client[method]('2026-09-01', '2026-09-02'),
        ).resolves.toEqual({ rows: [] })
      })

      it('accepts a valid empty result', async () => {
        fetchMock.mockResolvedValue(Response.json({ rows: [] }))
        await expect(
          client[method]('2026-09-01', '2026-09-02'),
        ).resolves.toEqual({ rows: [] })
      })

      it('rejects non-JSON success without exposing the response body', async () => {
        fetchMock.mockResolvedValue(
          new Response('<html>fixture provider error</html>'),
        )
        await expect(
          client[method]('2026-09-01', '2026-09-02'),
        ).rejects.toThrow('Invalid Adjust report response')
      })
    })
  }
})
