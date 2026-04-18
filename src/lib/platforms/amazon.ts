/**
 * Amazon Advertising API client (SP / SB / SD)
 *
 * https://advertising.amazon.com/API/docs/en-us/
 * Uses the v3 endpoint. Auth is LWA OAuth (access_token + profile id).
 */

export interface AmazonAdsConfig {
  accessToken: string
  refreshToken?: string
  profileId: string           // Amazon Advertising profile ID
  clientId: string            // LWA client ID
  clientSecret?: string
  region?: 'NA' | 'EU' | 'FE' // defaults to NA
}

const REGION_BASE: Record<'NA' | 'EU' | 'FE', string> = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
}

export class AmazonAdsClient {
  private config: AmazonAdsConfig

  constructor(config: AmazonAdsConfig) {
    this.config = { region: 'NA', ...config }
  }

  private get base() {
    return REGION_BASE[this.config.region || 'NA']
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.config.accessToken}`,
      'Amazon-Advertising-API-Scope': this.config.profileId,
      'Amazon-Advertising-API-ClientId': this.config.clientId,
      'Content-Type': 'application/json',
    }
  }

  async refreshAccessToken(): Promise<string> {
    if (!this.config.refreshToken || !this.config.clientSecret) {
      throw new Error('refreshToken + clientSecret required')
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    })
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`LWA refresh failed: ${data.error_description || data.error}`)
    this.config.accessToken = data.access_token
    return data.access_token
  }

  async getProfiles(): Promise<Array<{ profileId: string; countryCode: string; currencyCode: string; accountInfo: Record<string, unknown> }>> {
    const res = await fetch(`${this.base}/v2/profiles`, { headers: this.headers })
    return res.json()
  }

  async getCampaigns(): Promise<unknown> {
    const res = await fetch(`${this.base}/sp/campaigns/list`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({}),
    })
    return res.json()
  }

  /**
   * Create an "offline report" — Amazon's async report flow.
   * Returns a reportId that you poll via getReportStatus().
   */
  async createReport(params: {
    reportTypeId: string            // e.g. "spCampaigns"
    startDate: string               // YYYY-MM-DD
    endDate: string                 // YYYY-MM-DD
    groupBy?: string[]
    columns?: string[]
  }): Promise<{ reportId: string; status: string }> {
    const res = await fetch(`${this.base}/reporting/reports`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        name: `adex-${Date.now()}`,
        startDate: params.startDate,
        endDate: params.endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: params.groupBy || ['campaign'],
          columns: params.columns || ['impressions', 'clicks', 'cost', 'sales', 'purchases', 'campaignId', 'campaignName'],
          reportTypeId: params.reportTypeId,
          timeUnit: 'SUMMARY',
          format: 'GZIP_JSON',
        },
      }),
    })
    return res.json()
  }

  async getReportStatus(reportId: string): Promise<{ status: string; url?: string }> {
    const res = await fetch(`${this.base}/reporting/reports/${reportId}`, {
      headers: this.headers,
    })
    return res.json()
  }

  /**
   * Aggregate last-period metrics from a summary report. Returns normalized
   * impressions/clicks/spend/conversions/revenue for use with our Report table.
   * This is a synchronous best-effort — production should use the async
   * flow with polling via getReport/getReportStatus.
   */
  async getAggregatedReport(startDate: string, endDate: string): Promise<{
    impressions: number
    clicks: number
    spend: number
    conversions: number
    revenue: number
  }> {
    const { reportId } = await this.createReport({
      reportTypeId: 'spCampaigns',
      startDate,
      endDate,
    })
    // Poll up to ~30s
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const status = await this.getReportStatus(reportId)
      if (status.status === 'COMPLETED' && status.url) {
        const rawRes = await fetch(status.url)
        const rows = (await rawRes.json()) as Array<Record<string, unknown>>
        const agg = { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 }
        for (const row of rows) {
          agg.impressions += Number(row.impressions || 0)
          agg.clicks += Number(row.clicks || 0)
          agg.spend += Number(row.cost || 0)
          agg.conversions += Number(row.purchases || 0)
          agg.revenue += Number(row.sales || 0)
        }
        return agg
      }
      if (status.status === 'FAILED') {
        throw new Error('Amazon report generation failed')
      }
    }
    throw new Error('Amazon report timed out after 30s — try again later')
  }
}
