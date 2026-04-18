import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mailer'
import { completeText, isLLMConfigured } from '@/lib/llm'
import { GoogleAdsClient } from '@/lib/platforms/google'
import { MetaAdsClient } from '@/lib/platforms/meta'
import { TikTokAdsClient } from '@/lib/platforms/tiktok'
import { AppsFlyerClient } from '@/lib/platforms/appsflyer'
import { AdjustClient } from '@/lib/platforms/adjust'

/**
 * POST /api/cron/daily
 *
 * Intended to be invoked once per day by Google Cloud Scheduler (or any
 * cron) hitting this URL with a shared-secret header:
 *   X-Cron-Secret: <value of CRON_SECRET env var>
 *
 * Does three things for every organization:
 *   1. Pulls fresh performance data from every connected ad/MMP platform
 *   2. Stores each org's daily Report
 *   3. If any member of the org has a dailyReportEmail configured,
 *      sends them a digest of the org's last 24 h
 *
 * Writes a single JSON status response at the end summarizing each org.
 */

function checkCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided =
    req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace(/^Bearer /i, '')
  return provided === secret
}

type SyncMetrics = {
  impressions: number
  clicks: number
  conversions: number
  spend: number
  revenue: number
  installs: number
}

const empty = (): SyncMetrics => ({
  impressions: 0, clicks: 0, conversions: 0, spend: 0, revenue: 0, installs: 0,
})

const num = (x: unknown): number => {
  if (typeof x === 'number') return x
  if (typeof x === 'string') { const n = Number(x); return Number.isFinite(n) ? n : 0 }
  return 0
}

async function syncOne(
  platform: string,
  auth: { id: string; accessToken: string | null; refreshToken: string | null; accountId: string | null; appId: string | null; appSecret: string | null; apiKey: string | null },
  startDate: string,
  endDate: string
): Promise<SyncMetrics | { error: string }> {
  try {
    if (platform === 'google') {
      if (!auth.refreshToken || !auth.apiKey) return { error: 'missing credentials' }
      const client = new GoogleAdsClient({
        accessToken: auth.accessToken || '',
        refreshToken: auth.refreshToken,
        customerId: auth.accountId || '',
        developerToken: auth.apiKey,
      })
      const newToken = await client.refreshAccessToken()
      await prisma.platformAuth.update({ where: { id: auth.id }, data: { accessToken: newToken } })
      const customerIds = await client.listAccessibleCustomers()
      const metrics = empty()
      for (const cid of customerIds) {
        try {
          const data = await client.search(cid, 'SELECT customer.id, customer.manager FROM customer LIMIT 1')
          const customer = (data.results?.[0] as Record<string, Record<string, unknown>>)?.customer
          if (customer?.manager) continue
          const r = await client.getAggregatedReport(cid, startDate, endDate)
          metrics.impressions += r.impressions
          metrics.clicks += r.clicks
          metrics.conversions += r.conversions
          metrics.spend += r.spend
          metrics.revenue += r.revenue
        } catch { /* skip */ }
      }
      return metrics
    }
    if (platform === 'meta' && auth.accessToken && auth.accountId) {
      const accountId = auth.accountId.replace(/^act_/, '')
      const client = new MetaAdsClient({
        accessToken: auth.accessToken, adAccountId: accountId,
        appId: auth.appId || undefined, appSecret: auth.appSecret || undefined,
      })
      const data = await client.getReport(startDate, endDate)
      if (data.error) return { error: data.error.message }
      const metrics = empty()
      const rows: Array<Record<string, unknown>> = Array.isArray(data.data) ? data.data : []
      for (const row of rows) {
        metrics.impressions += num(row.impressions)
        metrics.clicks += num(row.clicks)
        metrics.spend += num(row.spend)
      }
      return metrics
    }
    if (platform === 'tiktok' && auth.accessToken && auth.accountId) {
      const client = new TikTokAdsClient({
        accessToken: auth.accessToken, advertiserId: auth.accountId,
        appId: auth.appId || undefined, secret: auth.appSecret || undefined,
      })
      const data = await client.getReport(startDate, endDate)
      if (data.code && data.code !== 0) return { error: data.message || 'tiktok error' }
      const metrics = empty()
      const list: Array<Record<string, unknown>> = Array.isArray(data.data?.list) ? data.data.list : []
      for (const row of list) {
        const m = (row.metrics as Record<string, unknown>) || row
        metrics.impressions += num(m.impressions)
        metrics.clicks += num(m.clicks)
        metrics.spend += num(m.spend)
        metrics.conversions += num(m.conversion)
      }
      return metrics
    }
    if (platform === 'appsflyer' && auth.apiKey && auth.appId) {
      const client = new AppsFlyerClient({ apiToken: auth.apiKey, appId: auth.appId })
      const data = await client.getInstallReport(startDate, endDate)
      if (!Array.isArray(data)) return { error: 'appsflyer error' }
      const metrics = empty()
      for (const row of data as Array<Record<string, unknown>>) {
        metrics.impressions += num(row.impressions)
        metrics.clicks += num(row.clicks)
        metrics.installs += num(row.installs)
        metrics.revenue += num(row.revenue)
        metrics.spend += num(row.cost)
      }
      metrics.conversions = metrics.installs
      return metrics
    }
    if (platform === 'adjust' && auth.apiKey && auth.appId) {
      const client = new AdjustClient({ apiToken: auth.apiKey, appToken: auth.appId })
      const data = await client.getReport(startDate, endDate)
      const rows: Array<Record<string, unknown>> = Array.isArray(data.rows) ? data.rows : []
      const metrics = empty()
      for (const row of rows) {
        metrics.impressions += num(row.impressions)
        metrics.clicks += num(row.clicks)
        metrics.installs += num(row.installs)
        metrics.revenue += num(row.revenue)
        metrics.spend += num(row.cost)
      }
      metrics.conversions = metrics.installs
      return metrics
    }
    return { error: 'unsupported or missing credentials' }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'sync error' }
  }
}

function derived(m: SyncMetrics) {
  return {
    ctr: m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0,
    cpc: m.clicks > 0 ? m.spend / m.clicks : 0,
    cpa: m.conversions > 0 ? m.spend / m.conversions : 0,
    roas: m.spend > 0 ? m.revenue / m.spend : 0,
  }
}

export async function POST(req: NextRequest) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized — set X-Cron-Secret header' }, { status: 401 })
  }

  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const orgs = await prisma.organization.findMany({
    include: {
      platformAuths: { where: { isActive: true } },
      members: { include: { user: true } },
    },
  })

  const summary: Array<{
    orgId: string
    orgName: string
    syncResults: Record<string, unknown>
    digestEmailsSent: number
  }> = []

  for (const org of orgs) {
    const syncResults: Record<string, unknown> = {}

    // 1. Sync every active platform and write a daily Report
    for (const auth of org.platformAuths) {
      const metrics = await syncOne(auth.platform, auth, startDate, endDate)
      if ('error' in metrics) {
        syncResults[auth.platform] = { error: metrics.error }
        continue
      }
      const reportId = `${auth.platform}-${org.id}-${endDate}`
      await prisma.report.upsert({
        where: { id: reportId },
        update: { ...metrics, ...derived(metrics), rawData: JSON.stringify({ cron: true, startDate, endDate }) },
        create: {
          id: reportId,
          orgId: org.id,
          userId: org.createdBy,
          platform: auth.platform,
          date: today,
          ...metrics,
          ...derived(metrics),
          rawData: JSON.stringify({ cron: true, startDate, endDate }),
        },
      })
      syncResults[auth.platform] = { ok: true, ...metrics }
    }

    // 2. Compute aggregate for the digest
    const reports = await prisma.report.findMany({
      where: { orgId: org.id, date: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    })
    const activeCampaigns = await prisma.campaign.count({
      where: { orgId: org.id, status: 'active' },
    })
    const agg = reports.reduce(
      (s, r) => ({
        spend: s.spend + r.spend,
        revenue: s.revenue + r.revenue,
        impressions: s.impressions + r.impressions,
        clicks: s.clicks + r.clicks,
        conversions: s.conversions + r.conversions,
        installs: s.installs + r.installs,
      }),
      { spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0, installs: 0 }
    )
    const roas = agg.spend > 0 ? agg.revenue / agg.spend : 0

    // 3. Optional AI narrative
    let aiSummary = ''
    if (isLLMConfigured() && reports.length > 0) {
      try {
        aiSummary = await completeText(
          `Write a 2-3 sentence executive summary for this ad account's last 24 h.
Spend $${agg.spend.toFixed(2)}, revenue $${agg.revenue.toFixed(2)}, ROAS ${roas.toFixed(2)}x,
impressions ${agg.impressions}, clicks ${agg.clicks}, conversions ${agg.conversions},
active campaigns ${activeCampaigns}. Cite numbers.`,
          { maxTokens: 300, temperature: 0.4 }
        )
      } catch (err) {
        console.error(`[cron] digest LLM failed for org ${org.id}:`, err)
      }
    }

    const html = buildDigestHtml(org.name, endDate, aiSummary, { ...agg, roas, activeCampaigns })

    // 4. Email every member who has a dailyReportEmail
    let digestEmailsSent = 0
    for (const m of org.members) {
      if (!m.user.dailyReportEmail) continue
      await prisma.dailyDigest.create({
        data: {
          userId: m.user.id,
          date: new Date(),
          content: html,
          advice: aiSummary || 'Automated daily digest.',
        },
      })
      const result = await sendMail({
        to: m.user.dailyReportEmail,
        subject: `Adex · ${org.name} · Daily Report · ${endDate}`,
        html,
      })
      if (result.ok) digestEmailsSent++
    }

    summary.push({ orgId: org.id, orgName: org.name, syncResults, digestEmailsSent })
  }

  return NextResponse.json({ ok: true, date: endDate, orgs: summary })
}

function buildDigestHtml(
  orgName: string,
  date: string,
  aiSummary: string,
  agg: { spend: number; revenue: number; impressions: number; clicks: number; conversions: number; installs: number; roas: number; activeCampaigns: number }
): string {
  const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #111827;">
      <h2 style="color:#2563eb; margin-bottom: 4px;">Adex Daily Digest</h2>
      <p style="color:#6b7280; margin-top:0;">${orgName} · ${date}</p>
      ${aiSummary ? `<p style="background:#f3f4f6; padding:12px 16px; border-radius:8px;">${aiSummary}</p>` : ''}
      <h3>Last 24 hours</h3>
      <table style="width:100%; border-collapse: collapse;">
        <tbody>
          <tr><td style="padding:6px 0;">Active Campaigns</td><td style="text-align:right;"><strong>${agg.activeCampaigns}</strong></td></tr>
          <tr><td style="padding:6px 0;">Spend</td><td style="text-align:right;"><strong>$${agg.spend.toFixed(2)}</strong></td></tr>
          <tr><td style="padding:6px 0;">Revenue</td><td style="text-align:right;"><strong>$${agg.revenue.toFixed(2)}</strong></td></tr>
          <tr><td style="padding:6px 0;">ROAS</td><td style="text-align:right;"><strong>${agg.roas.toFixed(2)}x</strong></td></tr>
          <tr><td style="padding:6px 0;">Impressions</td><td style="text-align:right;"><strong>${agg.impressions.toLocaleString()}</strong></td></tr>
          <tr><td style="padding:6px 0;">Clicks</td><td style="text-align:right;"><strong>${agg.clicks.toLocaleString()}</strong> (CTR ${ctr.toFixed(2)}%)</td></tr>
          <tr><td style="padding:6px 0;">Conversions</td><td style="text-align:right;"><strong>${agg.conversions.toLocaleString()}</strong></td></tr>
          <tr><td style="padding:6px 0;">Installs</td><td style="text-align:right;"><strong>${agg.installs.toLocaleString()}</strong></td></tr>
        </tbody>
      </table>
      <p style="color:#9ca3af; font-size:12px; margin-top:32px;">Generated by Adex · scheduled daily digest.</p>
    </div>
  `
}
