import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'
import { AppsFlyerClient } from '@/lib/platforms/appsflyer'
import { AdjustClient } from '@/lib/platforms/adjust'
import { AmazonAdsClient } from '@/lib/platforms/amazon'
import { LinkedInAdsClient } from '@/lib/platforms/linkedin'
import type { PlatformAuth } from '@/generated/prisma/client'
import { getAdapter, isAdaptablePlatform } from '@/lib/platforms/registry'
import { runAdapterSync } from '@/lib/sync/report-writer'

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
  orgId: string,
  userId: string,
  platform: string,
  date: Date,
  metrics: SyncMetrics,
  raw: unknown
) {
  const endDateStr = date.toISOString().split('T')[0]
  const reportId = `${platform}-${orgId}-${endDateStr}`
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
      orgId,
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

/**
 * For adaptable platforms (google/meta/tiktok) we delegate to the adapter
 * registry which writes BOTH account-level (legacy) and campaign-level (P11)
 * Report rows in one pass.
 */
async function syncViaAdapter(
  auth: PlatformAuth,
  orgId: string,
  userId: string,
  startDate: string,
  endDate: string,
  today: Date
) {
  const adapter = getAdapter(auth.platform, auth)
  const out = await runAdapterSync(adapter, { orgId, userId, startDate, endDate, today })
  return { success: true, ...out.account, campaignsWritten: out.campaignsWritten }
}

async function syncAppsFlyer(
  auth: PlatformAuth,
  orgId: string,
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

  await upsertReport(orgId, userId, 'appsflyer', today, metrics, {
    rows: data.length,
    startDate,
    endDate,
  })
  return { success: true, rows: data.length, ...metrics }
}

async function syncAdjust(
  auth: PlatformAuth,
  orgId: string,
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

  await upsertReport(orgId, userId, 'adjust', today, metrics, {
    rows: rows.length,
    startDate,
    endDate,
  })
  return { success: true, rows: rows.length, ...metrics }
}

async function syncAmazon(
  auth: PlatformAuth,
  orgId: string,
  userId: string,
  startDate: string,
  endDate: string,
  today: Date
) {
  if (!auth.accessToken || !auth.accountId || !auth.appId) {
    return { error: 'Missing access token, profile ID, or LWA client ID' }
  }
  const client = new AmazonAdsClient({
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken || undefined,
    profileId: auth.accountId,
    clientId: auth.appId,
    clientSecret: auth.appSecret || undefined,
  })

  if (auth.refreshToken && auth.appSecret) {
    try {
      const token = await client.refreshAccessToken()
      await prisma.platformAuth.update({
        where: { id: auth.id },
        data: { accessToken: token },
      })
    } catch (err) {
      return { error: `Amazon token refresh failed: ${err instanceof Error ? err.message : 'unknown'}` }
    }
  }

  const agg = await client.getAggregatedReport(startDate, endDate)
  const metrics = { ...emptyMetrics(), ...agg }
  await upsertReport(orgId, userId, 'amazon', today, metrics, { startDate, endDate })
  return { success: true, ...metrics }
}

async function syncLinkedIn(
  auth: PlatformAuth,
  orgId: string,
  userId: string,
  startDate: string,
  endDate: string,
  today: Date
) {
  if (!auth.accessToken || !auth.accountId) {
    return { error: 'Missing access token or account ID' }
  }
  const client = new LinkedInAdsClient({
    accessToken: auth.accessToken,
    accountId: auth.accountId,
    refreshToken: auth.refreshToken || undefined,
    clientId: auth.appId || undefined,
    clientSecret: auth.appSecret || undefined,
  })

  const agg = await client.getAggregatedReport(startDate, endDate)
  const metrics = { ...emptyMetrics(), ...agg }
  await upsertReport(orgId, userId, 'linkedin', today, metrics, { startDate, endDate })
  return { success: true, ...metrics }
}

// ---------------- Main handler ----------------

export async function POST() {
  let user, org
  try {
    const ctx = await requireAuthWithOrg()
    user = ctx.user
    org = ctx.org
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
      where: { orgId: org.id, isActive: true },
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
        if (isAdaptablePlatform(auth.platform)) {
          results[auth.platform] = await syncViaAdapter(
            auth,
            org.id,
            user.id,
            startDate,
            endDate,
            today
          )
          continue
        }
        switch (auth.platform) {
          case 'appsflyer':
            results.appsflyer = await syncAppsFlyer(auth, org.id, user.id, startDate, endDate, today)
            break
          case 'adjust':
            results.adjust = await syncAdjust(auth, org.id, user.id, startDate, endDate, today)
            break
          case 'amazon':
            results.amazon = await syncAmazon(auth, org.id, user.id, startDate, endDate, today)
            break
          case 'linkedin':
            results.linkedin = await syncLinkedIn(auth, org.id, user.id, startDate, endDate, today)
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
