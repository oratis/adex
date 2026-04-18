/**
 * LinkedIn Marketing API client
 *
 * https://learn.microsoft.com/en-us/linkedin/marketing/
 * Auth is OAuth 2.0 bearer token. Account ID is the "organization" / "ad
 * account" URN fragment (just the numeric part).
 */

export interface LinkedInAdsConfig {
  accessToken: string
  accountId: string            // numeric ad account id
  refreshToken?: string
  clientId?: string
  clientSecret?: string
}

const BASE = 'https://api.linkedin.com/rest'
const API_VERSION = '202401'

export class LinkedInAdsClient {
  private config: LinkedInAdsConfig

  constructor(config: LinkedInAdsConfig) {
    this.config = config
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.config.accessToken}`,
      'LinkedIn-Version': API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    }
  }

  async refreshAccessToken(): Promise<string> {
    if (!this.config.refreshToken || !this.config.clientId || !this.config.clientSecret) {
      throw new Error('refreshToken + clientId + clientSecret required')
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    })
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`LinkedIn refresh failed: ${data.error_description || data.error}`)
    this.config.accessToken = data.access_token
    return data.access_token
  }

  async getCampaigns(): Promise<unknown> {
    const url = `${BASE}/adAccounts/${this.config.accountId}/adCampaigns?q=search&search=(status:(values:List(ACTIVE,PAUSED,DRAFT)))`
    const res = await fetch(url, { headers: this.headers })
    return res.json()
  }

  /**
   * Fetch analytics for the ad account in a date range. Returns the raw
   * analytics rows; caller is expected to aggregate.
   */
  async getReport(startDate: string, endDate: string): Promise<unknown> {
    // Format YYYY-MM-DD → year/month/day object required by LinkedIn
    const d = (s: string) => {
      const [y, m, day] = s.split('-').map(Number)
      return `(year:${y},month:${m},day:${day})`
    }
    const url =
      `${BASE}/adAnalytics` +
      `?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY` +
      `&dateRange=(start:${d(startDate)},end:${d(endDate)})` +
      `&accounts=List(urn%3Ali%3AsponsoredAccount%3A${this.config.accountId})` +
      `&fields=impressions,clicks,costInUsd,externalWebsiteConversions,externalWebsitePostClickConversions,dateRange,pivotValues`
    const res = await fetch(url, { headers: this.headers })
    return res.json()
  }

  /**
   * Normalized aggregate — impressions/clicks/spend/conversions/revenue.
   * LinkedIn doesn't directly report revenue via ad-analytics (you'd need
   * lead-gen form submits or offline conversions), so revenue stays 0.
   */
  async getAggregatedReport(startDate: string, endDate: string): Promise<{
    impressions: number
    clicks: number
    spend: number
    conversions: number
    revenue: number
  }> {
    const data = await this.getReport(startDate, endDate) as { elements?: Array<Record<string, unknown>> }
    const rows = Array.isArray(data.elements) ? data.elements : []
    const agg = { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 }
    for (const row of rows) {
      agg.impressions += Number(row.impressions || 0)
      agg.clicks += Number(row.clicks || 0)
      agg.spend += Number(row.costInUsd || 0)
      agg.conversions += Number(row.externalWebsiteConversions || 0)
    }
    return agg
  }
}
