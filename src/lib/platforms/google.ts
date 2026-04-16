const API_VERSION = 'v23'
const ADS_API_BASE = `https://googleads.googleapis.com/${API_VERSION}`

export interface GoogleAdsConfig {
  accessToken: string
  refreshToken: string
  customerId: string      // MCC ID (login-customer-id)
  developerToken?: string
  clientId?: string       // OAuth client ID for token refresh
  clientSecret?: string   // OAuth client secret for token refresh
}

async function safeJson(res: Response) {
  const text = await res.text()
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text), text }
  } catch {
    return { ok: res.ok, status: res.status, data: null, text }
  }
}

export class GoogleAdsClient {
  private config: GoogleAdsConfig
  private currentAccessToken: string

  constructor(config: GoogleAdsConfig) {
    this.config = config
    this.currentAccessToken = config.accessToken
  }

  /**
   * Refresh the OAuth access token
   */
  async refreshAccessToken(): Promise<string> {
    const clientId = this.config.clientId || process.env.GOOGLE_ADS_CLIENT_ID || ''
    const clientSecret = this.config.clientSecret || process.env.GOOGLE_ADS_CLIENT_SECRET || ''

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(`Token refresh failed: ${data.error_description || data.error}`)
    }

    this.currentAccessToken = data.access_token
    return data.access_token
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.currentAccessToken}`,
      'developer-token': this.config.developerToken || '',
      'Content-Type': 'application/json',
    }
    // MCC login-customer-id for accessing sub-accounts
    const mccId = this.config.customerId?.replace(/[-\s]/g, '')
    if (mccId) {
      headers['login-customer-id'] = mccId
    }
    return headers
  }

  /**
   * Execute a GAQL query against a specific customer account
   */
  async search(customerId: string, query: string) {
    const cid = customerId.replace(/[-\s]/g, '')
    const res = await fetch(`${ADS_API_BASE}/customers/${cid}/googleAds:search`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ query }),
    })
    const result = await safeJson(res)
    if (!result.ok) {
      throw new Error(`Google Ads API error (${result.status}): ${result.data ? JSON.stringify(result.data).substring(0, 300) : result.text.substring(0, 300)}`)
    }
    return result.data as { results?: unknown[]; fieldMask?: string }
  }

  /**
   * List all accessible customer accounts
   */
  async listAccessibleCustomers(): Promise<string[]> {
    const res = await fetch(`${ADS_API_BASE}/customers:listAccessibleCustomers`, {
      headers: {
        'Authorization': `Bearer ${this.currentAccessToken}`,
        'developer-token': this.config.developerToken || '',
      },
    })
    const result = await safeJson(res)
    if (!result.ok) {
      throw new Error(`listAccessibleCustomers failed (${result.status}): ${JSON.stringify(result.data || result.text).substring(0, 300)}`)
    }
    const data = result.data as { resourceNames?: string[] }
    return (data.resourceNames || []).map(r => r.replace('customers/', ''))
  }

  /**
   * Get customer client accounts under MCC
   */
  async getClientAccounts(): Promise<Array<{ id: string; name: string; isManager: boolean }>> {
    const customerIds = await this.listAccessibleCustomers()
    const accounts: Array<{ id: string; name: string; isManager: boolean }> = []

    for (const cid of customerIds) {
      try {
        const result = await this.search(cid, 'SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1')
        const customer = (result.results?.[0] as Record<string, Record<string, unknown>>)?.customer
        accounts.push({
          id: (customer?.id as string) || cid,
          name: (customer?.descriptiveName as string) || 'Unnamed',
          isManager: (customer?.manager as boolean) || false,
        })
      } catch {
        accounts.push({ id: cid, name: '(access denied)', isManager: false })
      }
    }
    return accounts
  }

  /**
   * Get campaigns for a specific customer account
   */
  async getCampaigns(customerId?: string) {
    const cid = customerId || this.config.customerId
    return this.search(cid, `
      SELECT campaign.id, campaign.name, campaign.status,
             campaign_budget.amount_micros, metrics.impressions,
             metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `)
  }

  /**
   * Get performance report for all campaigns across a date range
   */
  async getReport(customerId: string, startDate: string, endDate: string) {
    return this.search(customerId, `
      SELECT segments.date, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.cost_micros, metrics.conversions_value,
             campaign.name, campaign.id
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
    `)
  }

  /**
   * Get aggregated report across date range for a customer
   */
  async getAggregatedReport(customerId: string, startDate: string, endDate: string) {
    const result = await this.search(customerId, `
      SELECT metrics.impressions, metrics.clicks, metrics.conversions,
             metrics.cost_micros, metrics.conversions_value
      FROM customer
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `)

    let impressions = 0, clicks = 0, conversions = 0, spend = 0, revenue = 0
    if (result.results) {
      for (const row of result.results) {
        const m = (row as Record<string, Record<string, string>>).metrics
        impressions += parseInt(m?.impressions || '0')
        clicks += parseInt(m?.clicks || '0')
        conversions += parseFloat(m?.conversions || '0')
        spend += parseInt(m?.costMicros || '0') / 1_000_000
        revenue += parseFloat(m?.conversionsValue || '0')
      }
    }

    return { impressions, clicks, conversions, spend, revenue }
  }

  async createCampaign(customerId: string, params: {
    name: string; budget: number; objective: string; startDate: string; endDate?: string
  }) {
    const cid = customerId.replace(/[-\s]/g, '')
    // Create budget
    const budgetRes = await fetch(`${ADS_API_BASE}/customers/${cid}/campaignBudgets:mutate`, {
      method: 'POST', headers: this.getHeaders(),
      body: JSON.stringify({ operations: [{ create: { name: `${params.name}_budget`, amountMicros: String(params.budget * 1_000_000), deliveryMethod: 'STANDARD' } }] }),
    })
    const budgetData = await (await safeJson(budgetRes)).data as Record<string, unknown[]>

    // Create campaign
    const res = await fetch(`${ADS_API_BASE}/customers/${cid}/campaigns:mutate`, {
      method: 'POST', headers: this.getHeaders(),
      body: JSON.stringify({ operations: [{ create: { name: params.name, advertisingChannelType: 'DISPLAY', status: 'PAUSED', campaignBudget: (budgetData?.results?.[0] as Record<string, string>)?.resourceName, startDate: params.startDate.replace(/[-\s]/g, ''), endDate: params.endDate?.replace(/[-\s]/g, '') } }] }),
    })
    return (await safeJson(res)).data
  }

  async updateCampaignStatus(customerId: string, campaignId: string, status: 'ENABLED' | 'PAUSED') {
    const cid = customerId.replace(/[-\s]/g, '')
    const res = await fetch(`${ADS_API_BASE}/customers/${cid}/campaigns:mutate`, {
      method: 'POST', headers: this.getHeaders(),
      body: JSON.stringify({ operations: [{ update: { resourceName: `customers/${cid}/campaigns/${campaignId}`, status }, updateMask: 'status' }] }),
    })
    return (await safeJson(res)).data
  }
}
