import { AmazonAdsClient } from './amazon'
import { BaseAdapter, safeCall } from './base-adapter'
import type { AdapterFactoryInput, AccountReport, DateRange } from './adapter'
import { PlatformError } from './adapter'

/**
 * Amazon adapter — read-only. The current AmazonAdsClient exposes
 * createReport / getAggregatedReport but no campaign-mutation endpoints, so
 * this adapter delegates the read paths and inherits the BaseAdapter
 * `unsupported` behavior for write methods. Sync workers can now treat
 * Amazon uniformly with Google/Meta/TikTok.
 */
export class AmazonAdsAdapter extends BaseAdapter {
  readonly platform = 'amazon' as const
  readonly accountId: string
  private client: AmazonAdsClient

  constructor(input: AdapterFactoryInput) {
    super(input.authId)
    if (!input.accessToken || !input.accountId || !input.appId) {
      throw new PlatformError(
        'invalid_argument',
        'Amazon adapter requires accessToken + accountId (profileId) + appId (LWA client id)',
        'amazon'
      )
    }
    this.accountId = input.accountId
    this.client = new AmazonAdsClient({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken || undefined,
      profileId: input.accountId,
      clientId: input.appId,
      clientSecret: input.appSecret || undefined,
    })
  }

  async refreshAuth() {
    if (!(this.client as unknown as { config: { refreshToken?: string; clientSecret?: string } }).config.refreshToken)
      return {}
    const token = await safeCall(this.platform, () => this.client.refreshAccessToken())
    await this.persistRefreshedToken(token)
    return { accessToken: token }
  }

  async fetchAccountReport(range: DateRange): Promise<AccountReport> {
    await this.refreshAuth()
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

  // Campaign-level Amazon reporting requires a different report type endpoint;
  // until it's added to the client we return an empty list so the sync writer
  // doesn't blow up on adaptable platforms missing campaign breakdown.
  async fetchCampaignReport(): Promise<never[]> {
    return []
  }
}
