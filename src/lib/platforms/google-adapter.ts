import { GoogleAdsClient } from './google'
import { BaseAdapter, safeCall, toPlatformDate } from './base-adapter'
import type {
  AdapterFactoryInput,
  AccountReport,
  CampaignReport,
  CreateAdGroupInput,
  CreateAdInput,
  DateRange,
  DesiredStatus,
  LaunchCampaignInput,
  LaunchResult,
  PlatformCampaignSnapshot,
  SyncedStatus,
} from './adapter'
import { PlatformError } from './adapter'

const GOOGLE_STATUS_MAP: Record<DesiredStatus, 'ENABLED' | 'PAUSED' | 'REMOVED'> = {
  active: 'ENABLED',
  paused: 'PAUSED',
  archived: 'REMOVED',
}

function fromGoogleStatus(s: string | undefined): SyncedStatus {
  switch (s) {
    case 'ENABLED':
      return 'active'
    case 'PAUSED':
      return 'paused'
    case 'REMOVED':
      return 'removed'
    case 'PENDING':
      return 'pending'
    default:
      return 'unknown'
  }
}

export class GoogleAdsAdapter extends BaseAdapter {
  readonly platform = 'google' as const
  readonly accountId: string
  private client: GoogleAdsClient

  constructor(input: AdapterFactoryInput) {
    super(input.authId)
    if (!input.refreshToken || !input.apiKey || !input.accountId) {
      throw new PlatformError(
        'invalid_argument',
        'Google adapter requires refreshToken, developer token (apiKey), accountId',
        'google'
      )
    }
    this.accountId = input.accountId
    this.client = new GoogleAdsClient({
      accessToken: input.accessToken || '',
      refreshToken: input.refreshToken,
      customerId: input.accountId,
      developerToken: input.apiKey,
    })
  }

  async refreshAuth() {
    const token = await safeCall(this.platform, () => this.client.refreshAccessToken())
    await this.persistRefreshedToken(token)
    return { accessToken: token }
  }

  async launchCampaign(input: LaunchCampaignInput): Promise<LaunchResult> {
    await this.refreshAuth()
    const raw = (await safeCall(this.platform, () =>
      this.client.createCampaign(this.accountId, {
        name: input.name,
        budget: input.dailyBudget ?? 50,
        objective: input.objective || 'DISPLAY',
        startDate: toPlatformDate(input.startDate),
        endDate: input.endDate ? toPlatformDate(input.endDate) : undefined,
      })
    )) as Record<string, unknown> | null
    const results = (raw as { results?: Array<{ resourceName?: string }> } | null)?.results
    const resourceName = results?.[0]?.resourceName || ''
    const platformCampaignId = resourceName.split('/').pop() || resourceName
    if (!platformCampaignId) {
      throw new PlatformError(
        'unknown',
        'Google launch returned no campaign id',
        'google',
        undefined,
        raw
      )
    }
    return { platformCampaignId, raw }
  }

  async updateCampaignStatus(platformCampaignId: string, status: DesiredStatus): Promise<void> {
    const apiStatus = GOOGLE_STATUS_MAP[status]
    if (apiStatus === 'REMOVED') {
      // Google's REMOVED is irreversible — surface it explicitly.
      throw new PlatformError('invalid_argument', 'Google does not support archive without removal', 'google')
    }
    await this.refreshAuth()
    await safeCall(this.platform, () =>
      this.client.updateCampaignStatus(this.accountId, platformCampaignId, apiStatus)
    )
  }

  async updateCampaignBudget(platformCampaignId: string, dailyBudget: number): Promise<void> {
    // Google Ads model: a Campaign has a single CampaignBudget. To change the
    // daily amount we look up the budget resource via GAQL and POST a mutate
    // op against it. We do NOT use createCampaign-style budget creation here
    // since that would orphan the existing budget row.
    await this.refreshAuth()
    const cid = this.accountId.replace(/[-\s]/g, '')
    const data = await safeCall(this.platform, () =>
      this.client.search(
        cid,
        `SELECT campaign.id, campaign.campaign_budget
         FROM campaign
         WHERE campaign.id = ${platformCampaignId}
         LIMIT 1`
      )
    )
    const row = (data.results?.[0] as Record<string, Record<string, unknown>>) || {}
    const budgetResource = String(row.campaign?.campaignBudget || row.campaign?.campaign_budget || '')
    if (!budgetResource) {
      throw new PlatformError(
        'not_found',
        `No campaign_budget found for campaign ${platformCampaignId}`,
        'google'
      )
    }
    await safeCall(this.platform, async () => {
      const headers: Record<string, string> = (
        this.client as unknown as { getHeaders: () => Record<string, string> }
      ).getHeaders
        ? (this.client as unknown as { getHeaders: () => Record<string, string> }).getHeaders()
        : {}
      const res = await fetch(
        `https://googleads.googleapis.com/v23/customers/${cid}/campaignBudgets:mutate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            operations: [
              {
                update: {
                  resourceName: budgetResource,
                  amountMicros: String(Math.round(dailyBudget * 1_000_000)),
                },
                updateMask: 'amount_micros',
              },
            ],
          }),
        }
      )
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Google budget update failed (${res.status}): ${text.slice(0, 300)}`)
      }
    })
  }

  async createAdGroup(
    input: CreateAdGroupInput
  ): Promise<{ platformAdGroupId: string; raw: unknown }> {
    await this.refreshAuth()
    const raw = (await safeCall(this.platform, () =>
      this.client.createAdGroup(this.accountId, {
        campaignId: input.platformCampaignId,
        name: input.name,
        // Convert daily budget hint → CPC bid floor (1% of daily budget,
        // floored at $0.50).
        cpcBidMicros: input.dailyBudget
          ? Math.max(500_000, Math.round(input.dailyBudget * 1_000_000 * 0.01))
          : undefined,
      })
    )) as { results?: Array<{ resourceName?: string }> } | null
    const resourceName = raw?.results?.[0]?.resourceName || ''
    const platformAdGroupId = resourceName.split('/').pop() || resourceName
    if (!platformAdGroupId) {
      throw new PlatformError(
        'unknown',
        'Google createAdGroup returned no id',
        'google',
        undefined,
        raw
      )
    }
    return { platformAdGroupId, raw }
  }

  async createAd(input: CreateAdInput): Promise<{ platformAdId: string; raw: unknown }> {
    if (!input.headline || !input.description || !input.destinationUrl) {
      throw new PlatformError(
        'invalid_argument',
        'Google createAd requires headline + description + destinationUrl',
        'google'
      )
    }
    await this.refreshAuth()
    const raw = (await safeCall(this.platform, () =>
      this.client.createAd(this.accountId, {
        adGroupId: input.platformAdGroupId,
        name: input.name,
        headline: input.headline!,
        description: input.description!,
        finalUrl: input.destinationUrl!,
        marketingImageUrl: input.creative?.fileUrl,
      })
    )) as { results?: Array<{ resourceName?: string }> } | null
    const resourceName = raw?.results?.[0]?.resourceName || ''
    const platformAdId = resourceName.split('/').pop() || resourceName
    if (!platformAdId) {
      throw new PlatformError(
        'unknown',
        'Google createAd returned no id',
        'google',
        undefined,
        raw
      )
    }
    return { platformAdId, raw }
  }

  async fetchCampaignList(): Promise<PlatformCampaignSnapshot[]> {
    await this.refreshAuth()
    const customerIds = await safeCall(this.platform, () => this.client.listAccessibleCustomers())
    const out: PlatformCampaignSnapshot[] = []
    for (const cid of customerIds) {
      try {
        const data = await this.client.search(
          cid,
          `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros
           FROM campaign WHERE campaign.status != 'REMOVED'`
        )
        const rows = (data.results || []) as Array<Record<string, Record<string, unknown>>>
        for (const row of rows) {
          const c = row.campaign || {}
          const b = row.campaign_budget || row.campaignBudget || {}
          const budgetMicros = Number(b.amountMicros || b.amount_micros || 0)
          out.push({
            platformCampaignId: String(c.id || ''),
            name: String(c.name || ''),
            status: fromGoogleStatus(c.status as string | undefined),
            dailyBudget: budgetMicros / 1_000_000 || undefined,
            raw: row,
          })
        }
      } catch {
        // skip inaccessible accounts
      }
    }
    return out
  }

  async fetchAccountReport(range: DateRange): Promise<AccountReport> {
    await this.refreshAuth()
    const customerIds = await safeCall(this.platform, () => this.client.listAccessibleCustomers())
    const acc: AccountReport = {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      spend: 0,
      revenue: 0,
    }
    for (const cid of customerIds) {
      try {
        const data = await this.client.search(
          cid,
          'SELECT customer.id, customer.manager FROM customer LIMIT 1'
        )
        const customer = (data.results?.[0] as Record<string, Record<string, unknown>>)?.customer
        if (customer?.manager) continue
        const r = await this.client.getAggregatedReport(cid, range.startDate, range.endDate)
        acc.impressions += r.impressions
        acc.clicks += r.clicks
        acc.conversions += r.conversions
        acc.spend += r.spend
        acc.revenue += r.revenue
      } catch {
        // skip
      }
    }
    return acc
  }

  async fetchCampaignReport(range: DateRange): Promise<CampaignReport[]> {
    await this.refreshAuth()
    const customerIds = await safeCall(this.platform, () => this.client.listAccessibleCustomers())
    const out: CampaignReport[] = []
    for (const cid of customerIds) {
      try {
        const data = await this.client.search(
          cid,
          `SELECT segments.date, campaign.id, campaign.name,
                  metrics.impressions, metrics.clicks, metrics.conversions,
                  metrics.cost_micros, metrics.conversions_value
           FROM campaign
           WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
             AND campaign.status != 'REMOVED'`
        )
        const rows = (data.results || []) as Array<Record<string, Record<string, unknown>>>
        for (const row of rows) {
          const seg = row.segments || {}
          const c = row.campaign || {}
          const m = row.metrics || {}
          out.push({
            platformCampaignId: String(c.id || ''),
            campaignName: String(c.name || ''),
            date: String(seg.date || range.endDate),
            impressions: Number(m.impressions || 0),
            clicks: Number(m.clicks || 0),
            conversions: Number(m.conversions || 0),
            spend: Number(m.costMicros || 0) / 1_000_000,
            revenue: Number(m.conversionsValue || 0),
          })
        }
      } catch {
        // skip
      }
    }
    return out
  }
}
