import { LinkedInAdsClient } from './linkedin'
import { BaseAdapter, safeCall } from './base-adapter'
import type { AdapterFactoryInput, AccountReport, DateRange } from './adapter'
import { PlatformError } from './adapter'

export class LinkedInAdsAdapter extends BaseAdapter {
  readonly platform = 'linkedin' as const
  readonly accountId: string
  private client: LinkedInAdsClient

  constructor(input: AdapterFactoryInput) {
    super(input.authId)
    if (!input.accessToken || !input.accountId) {
      throw new PlatformError(
        'invalid_argument',
        'LinkedIn adapter requires accessToken + accountId',
        'linkedin'
      )
    }
    this.accountId = input.accountId
    this.client = new LinkedInAdsClient({
      accessToken: input.accessToken,
      accountId: input.accountId,
      refreshToken: input.refreshToken || undefined,
      clientId: input.appId || undefined,
      clientSecret: input.appSecret || undefined,
    })
  }

  async fetchAccountReport(range: DateRange): Promise<AccountReport> {
    const agg = await safeCall(this.platform, () =>
      this.client.getAggregatedReport(range.startDate, range.endDate)
    )
    return {
      impressions: agg.impressions || 0,
      clicks: agg.clicks || 0,
      conversions: agg.conversions || 0,
      spend: agg.spend || 0,
      revenue: agg.revenue || 0,
    }
  }

  async fetchCampaignReport(): Promise<never[]> {
    return []
  }
}
