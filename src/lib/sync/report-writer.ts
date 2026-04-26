import { prisma } from '@/lib/prisma'
import type { PlatformAdapter, AccountReport, CampaignReport } from '@/lib/platforms/adapter'
import { upsertPlatformLink } from '@/lib/platforms/links'

export type SyncMetrics = {
  impressions: number
  clicks: number
  conversions: number
  spend: number
  revenue: number
  installs: number
}

export const emptyMetrics = (): SyncMetrics => ({
  impressions: 0,
  clicks: 0,
  conversions: 0,
  spend: 0,
  revenue: 0,
  installs: 0,
})

export function derived(m: SyncMetrics) {
  return {
    ctr: m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0,
    cpc: m.clicks > 0 ? m.spend / m.clicks : 0,
    cpa: m.conversions > 0 ? m.spend / m.conversions : 0,
    roas: m.spend > 0 ? m.revenue / m.spend : 0,
  }
}

function fromAccountReport(r: AccountReport): SyncMetrics {
  return {
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    spend: r.spend,
    revenue: r.revenue,
    installs: r.installs ?? 0,
  }
}

function fromCampaignReport(r: CampaignReport): SyncMetrics {
  return fromAccountReport(r)
}

/**
 * Upsert one Report row at level=account. Uses the legacy
 * "${platform}-${orgId}-${endDate}" id so existing dashboard code keeps
 * working unchanged.
 */
export async function writeAccountReport(opts: {
  orgId: string
  userId: string
  platform: string
  date: Date
  metrics: SyncMetrics
  raw: unknown
}) {
  const endDateStr = opts.date.toISOString().split('T')[0]
  const id = `${opts.platform}-${opts.orgId}-${endDateStr}`
  const d = derived(opts.metrics)
  await prisma.report.upsert({
    where: { id },
    update: {
      ...opts.metrics,
      ...d,
      level: 'account',
      rawData: JSON.stringify(opts.raw),
    },
    create: {
      id,
      orgId: opts.orgId,
      userId: opts.userId,
      platform: opts.platform,
      date: opts.date,
      level: 'account',
      ...opts.metrics,
      ...d,
      rawData: JSON.stringify(opts.raw),
    },
  })
}

/**
 * Upsert one Report row per campaign per day. Resolves (or creates) the
 * PlatformLink so that future agent reads can join Reports back to the local
 * campaign. Date is taken from each row, not opts.date.
 */
export async function writeCampaignReports(opts: {
  orgId: string
  userId: string
  platform: string
  accountId: string
  rows: CampaignReport[]
}) {
  for (const row of opts.rows) {
    if (!row.platformCampaignId) continue
    const link = await upsertPlatformLink({
      orgId: opts.orgId,
      platform: opts.platform,
      accountId: opts.accountId,
      entityType: 'campaign',
      // No local campaign yet — use the platform id as the local key so the
      // record exists and can be joined later. A subsequent local launch will
      // overwrite localEntityId via the same upsert.
      localEntityId: row.platformCampaignId,
      platformEntityId: row.platformCampaignId,
      metadata: row.campaignName ? { discoveredName: row.campaignName } : undefined,
    })
    const date = new Date(row.date)
    if (Number.isNaN(date.getTime())) continue
    const dateStr = row.date
    const id = `${opts.platform}-${opts.orgId}-camp-${row.platformCampaignId}-${dateStr}`
    const metrics = fromCampaignReport(row)
    const d = derived(metrics)
    await prisma.report.upsert({
      where: { id },
      update: {
        ...metrics,
        ...d,
        level: 'campaign',
        campaignLinkId: link.id,
        rawData: JSON.stringify(row),
      },
      create: {
        id,
        orgId: opts.orgId,
        userId: opts.userId,
        platform: opts.platform,
        date,
        level: 'campaign',
        campaignLinkId: link.id,
        ...metrics,
        ...d,
        rawData: JSON.stringify(row),
      },
    })
  }
}

export type SyncOutcome = {
  platform: string
  account: SyncMetrics & { ctr: number; cpc: number; cpa: number; roas: number }
  campaignsWritten: number
}

/**
 * Run a full sync (account + campaign) for a single adapter. Returns a
 * compact summary for caller logging; throws on hard failure.
 */
export async function runAdapterSync(
  adapter: PlatformAdapter,
  opts: {
    orgId: string
    userId: string
    startDate: string
    endDate: string
    today: Date
  }
): Promise<SyncOutcome> {
  const range = { startDate: opts.startDate, endDate: opts.endDate }
  const account = await adapter.fetchAccountReport(range)
  const accountMetrics = fromAccountReport(account)
  await writeAccountReport({
    orgId: opts.orgId,
    userId: opts.userId,
    platform: adapter.platform,
    date: opts.today,
    metrics: accountMetrics,
    raw: { account, range },
  })

  let campaignsWritten = 0
  try {
    const rows = await adapter.fetchCampaignReport(range)
    await writeCampaignReports({
      orgId: opts.orgId,
      userId: opts.userId,
      platform: adapter.platform,
      accountId: adapter.accountId,
      rows,
    })
    campaignsWritten = rows.length
  } catch (err) {
    // campaign-level is best-effort; the account-level row is the contract.
    console.error(`[sync] campaign report failed for ${adapter.platform}:`, err)
  }
  return { platform: adapter.platform, account: { ...accountMetrics, ...derived(accountMetrics) }, campaignsWritten }
}
