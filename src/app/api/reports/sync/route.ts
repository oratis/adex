import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { GoogleAdsClient } from '@/lib/platforms/google'
import { MetaAdsClient } from '@/lib/platforms/meta'
import { TikTokAdsClient } from '@/lib/platforms/tiktok'
import { AppsFlyerClient } from '@/lib/platforms/appsflyer'
import { AdjustClient } from '@/lib/platforms/adjust'
import type { PlatformAuth } from '@/generated/prisma/client'

type SyncMetrics = {
  impressions: number
  clicks: number
  conversions: number
  spend: number
  revenue: number
  installs: number
}

function emptyMetrics(): SyncMetrics {
  return { impressions: 0, clicks: 0, conversions: 0, spend: 0, revenue: 0, installs: 0 }
}

function num(x: unknown): number {
  if (typeof x === 'number') return x
  if (typeof x === 'string') {
    const n = Number(x)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function derived(m: SyncMetrics) {
  return {
    ctr: m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0,
    cpc: m.clicks > 0 ? m.spend / m.clicks : 0,
    cpa: m.conversions > 0 ? m.spend / m.conversions : 0,
    roas: m.spend > 0 ? m.revenue / m.spend : 0,
  }
}

async function upsertReport(
  userId: string,
  platform: string,
  date: Date,
  metrics: SyncMetrics,
  raw: unknown
) {
  const endDateStr = date.toISOString().split('T')[0]
  const reportId = `${platform}-${userId}-${endDateStr}`
  const d = derived(metrics)

  await prisma.report.upsert({
    where: { id: reportId },
    update: {
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      conversions: metrics.conversions,
      spend: metrics.spend,
      revenue: metrics.revenue,
      installs: metrics.installs,
      ...d,
      rawData: JSON.stringify(raw),
    },
    create: {
      id: reportId,
      userId,
      platform,
      date,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      conversions: metrics.conversions,
      spend: metrics.spend,
      revenue: metrics.revenue,
      installs: metrics.installs,
      ...d,
      rawData: JSON.stringify(raw),
    },
  })
}

// ---------------- Per-platform handlers ----------------

async function syncGoogle(
  auth: PlatformAuth,
  userId: string,
  startDate: string,
  endDate: string,
  today: Date
) {
  if (!auth.refreshToken || !auth.apiKey) {
    return { error: 'Missing refresh token or developer token' }
  }

  const client = new GoogleAdsClient({
    accessToken: auth.accessToken || '',
    refreshToken: auth.refreshToken,
    customerId: auth.accountId || '',
    developerToken: auth.apiKey,
  })

  const newToken = await client.refreshAccessToken()
  await prisma.platformAuth.update({
    where: { id: auth.id },
    data: { accessToken: newToken },
  })

  const customerIds = await client.listAccessibleCustomers()
  const nonManagerIds: string[] = []

  for (const cid of customerIds) {
    try {
      const data = await client.search(
        cid,
        'SELECT customer.id, customer.manager FROM customer LIMIT 1'
      )
      const customer = (data.results?.[0] as Record<string, Record<string, unknown>>)?.customer
      if (!customer?.manager) {
        nonManagerIds.push(cid)
      }
    } catch {
      // Skip inaccessible
    }
  }

  const metrics = emptyMetrics()
  for (const cid of nonManagerIds) {
    try {
      const report = await client.getAggregatedReport(cid, startDate, endDate)
      metrics.impressions += report.impressions
      metrics.clicks += report.clicks
      metrics.conversions += report.conversions
      metrics.spend += report.spend
      metrics.revenue += report.revenue
    } catch (err) {
      console.error(`Google Ads report failed for ${cid}:`, err)
    }
  }

  await upsertReport(userId, 'google', today, metrics, {
    customerIds: nonManagerIds,
    startDate,
    endDate,
  })

  return { success: true, accounts: nonManagerIds.length, ...metrics }
}

async function syncMeta(
  auth: PlatformAuth,
  userId: string,
  startDate: string,
  endDate: string,
  today: Date
) {
  if (!auth.accessToken || !auth.accountId) {
    return { error: 'Missing access token or ad account ID' }
  }

  // Strip optional "act_" prefix; client re-adds it
  const accountId = auth.accountId.replace(/^act_/, '')
  const client = new MetaAdsClient({
    accessToken: auth.accessToken,
    adAccountId: accountId,
    appId: auth.appId || undefined,
    appSecret: auth.appSecret || undefined,
  })

  const data = await client.getReport(startDate, endDate)
  if (data.error) {
    return { error: data.error.message || 'Meta API error' }
  }

  const rows: Array<Record<string, unknown>> = Array.isArray(data.data) ? data.data : []
  const metrics = emptyMetrics()

  for (const row of rows) {
    metrics.impressions += num(row.impressions)
    metrics.clicks += num(row.clicks)
    metrics.spend += num(row.spend)

    // Actions: try to find purchase / conversions; revenue via action_values
    const actions = Array.isArray(row.actions) ? (row.actions as Array<Record<string, unknown>>) : []
    for (const a of actions) {
      const t = String(a.action_type || '')
      if (t === 'purchase' || t === 'offsite_conversion.fb_pixel_purchase' || t.includes('conversion')) {
        metrics.conversions += num(a.value)
      }
      if (t === 'mobile_app_install' || t === 'app_install') {
        metrics.installs += num(a.value)
      }
    }
    const actionValues = Array.isArray(row.action_values)
      ? (row.action_values as Array<Record<string, unknown>>)
      : []
    for (const a of actionValues) {
      const t = String(a.action_type || '')
      if (t === 'purchase' || t.includes('conversion')) {
        metrics.revenue += num(a.value)
      }
    }
  }

  await upsertReport(userId, 'meta', today, metrics, { rows: rows.length, startDate, endDate })
  return { success: true, rows: rows.length, ...metrics }
}

async function syncTikTok(
  auth: PlatformAuth,
  userId: string,
  startDate: string,
  endDate: string,
  today: Date
) {
  if (!auth.accessToken || !auth.accountId) {
    return { error: 'Missing access token or advertiser ID' }
  }

  const client = new TikTokAdsClient({
    accessToken: auth.accessToken,
    advertiserId: auth.accountId,
    appId: auth.appId || undefined,
    secret: auth.appSecret || undefined,
  })

  const data = await client.getReport(startDate, endDate)
  if (data.code && data.code !== 0) {
    return { error: data.message || 'TikTok API error' }
  }

  const list: Array<Record<string, unknown>> = Array.isArray(data.data?.list) ? data.data.list : []
  const metrics = emptyMetrics()

  for (const row of list) {
    const m = (row.metrics as Record<string, unknown>) || row
    metrics.impressions += num(m.impressions)
    metrics.clicks += num(m.clicks)
    metrics.spend += num(m.spend)
    metrics.conversions += num(m.conversion)
  }

  await upsertReport(userId, 'tiktok', today, metrics, {
    rows: list.length,
    startDate,
    endDate,
  })
  return { success: true, rows: list.length, ...metrics }
}

async function syncAppsFlyer(
  auth: PlatformAuth,
  userId: string,
  startDate: string,
  endDate: string,
  today: Date
) {
  if (!auth.apiKey || !auth.appId) {
    return { error: 'Missing API token or app ID' }
  }

  const client = new AppsFlyerClient({
    apiToken: auth.apiKey,
    appId: auth.appId,
  })

  const data = await client.getInstallReport(startDate, endDate)
  // AppsFlyer v5 returns an array of rows, or an error object
  if (!Array.isArray(data)) {
    return { error: (data && (data.error || data.message)) || 'AppsFlyer API error' }
  }

  const metrics = emptyMetrics()
  for (const row of data as Array<Record<string, unknown>>) {
    metrics.impressions += num(row.impressions)
    metrics.clicks += num(row.clicks)
    metrics.installs += num(row.installs)
    metrics.revenue += num(row.revenue)
    metrics.spend += num(row.cost)
  }
  // Conversions on install side = installs
  metrics.conversions = metrics.installs

  await upsertReport(userId, 'appsflyer', today, metrics, {
    rows: data.length,
    startDate,
    endDate,
  })
  return { success: true, rows: data.length, ...metrics }
}

async function syncAdjust(
  auth: PlatformAuth,
  userId: string,
  startDate: string,
  endDate: string,
  today: Date
) {
  if (!auth.apiKey || !auth.appId) {
    return { error: 'Missing API token or app token' }
  }

  const client = new AdjustClient({
    apiToken: auth.apiKey,
    appToken: auth.appId,
  })

  const data = await client.getReport(startDate, endDate)
  const rows: Array<Record<string, unknown>> = Array.isArray(data.rows)
    ? data.rows
    : Array.isArray(data)
    ? data
    : []

  if (rows.length === 0 && data.error) {
    return { error: String(data.error) }
  }

  const metrics = emptyMetrics()
  for (const row of rows) {
    metrics.impressions += num(row.impressions)
    metrics.clicks += num(row.clicks)
    metrics.installs += num(row.installs)
    metrics.revenue += num(row.revenue)
    metrics.spend += num(row.cost)
  }
  metrics.conversions = metrics.installs

  await upsertReport(userId, 'adjust', today, metrics, {
    rows: rows.length,
    startDate,
    endDate,
  })
  return { success: true, rows: rows.length, ...metrics }
}

// ---------------- Main handler ----------------

export async function POST() {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, unknown> = {}
  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  try {
    const auths = await prisma.platformAuth.findMany({
      where: { userId: user.id, isActive: true },
    })

    if (auths.length === 0) {
      return NextResponse.json({
        synced: true,
        results: { info: 'No platforms connected. Go to Settings to connect.' },
        dateRange: { startDate, endDate },
      })
    }

    for (const auth of auths) {
      try {
        switch (auth.platform) {
          case 'google':
            results.google = await syncGoogle(auth, user.id, startDate, endDate, today)
            break
          case 'meta':
            results.meta = await syncMeta(auth, user.id, startDate, endDate, today)
            break
          case 'tiktok':
            results.tiktok = await syncTikTok(auth, user.id, startDate, endDate, today)
            break
          case 'appsflyer':
            results.appsflyer = await syncAppsFlyer(auth, user.id, startDate, endDate, today)
            break
          case 'adjust':
            results.adjust = await syncAdjust(auth, user.id, startDate, endDate, today)
            break
          default:
            // Skip creative-only platforms (seedream, seedance, seedance2, etc.)
            results[auth.platform] = { skipped: 'Not a reporting platform' }
        }
      } catch (err) {
        results[auth.platform] = {
          error: err instanceof Error ? err.message : 'Sync failed',
        }
      }
    }
  } catch (err) {
    return NextResponse.json(
      {
        synced: false,
        error: err instanceof Error ? err.message : 'Sync failed',
        results,
        dateRange: { startDate, endDate },
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ synced: true, results, dateRange: { startDate, endDate } })
}
