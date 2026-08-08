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

  // Audit High #10 — exposed as public so adapter code doesn't have to
  // cast through `as unknown`. Identifying headers (auth + dev token) need
  // to be reachable for ad-hoc REST calls (e.g. campaignBudgets:mutate).
  getAuthHeaders(): Record<string, string> {
    return this.getHeaders()
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
   * List every customer_client under the configured MCC (login-customer-id).
   * Returns the full tree (the MCC itself + every sub-account it manages),
   * which is what the Google Ads UI shows when you click the account picker.
   *
   * Pure listAccessibleCustomers only returns accounts the OAuth user is
   * *directly* linked to — it does NOT enumerate accounts owned through the
   * MCC. So an MCC like 830-379-6268 will surface itself but hide its sub
   * accounts (348-133-3068, 993-913-5964, ...). Querying customer_client
   * against the MCC closes that gap.
   */
  async listMccClients(
    mccId?: string
  ): Promise<Array<{ id: string; name: string; isManager: boolean; hidden: boolean; status: string; level: number }>> {
    const cid = (mccId || this.config.customerId || '').replace(/[-\s]/g, '')
    if (!cid) throw new Error('listMccClients requires an MCC customer id')
    const result = await this.search(
      cid,
      `SELECT customer_client.client_customer,
              customer_client.id,
              customer_client.descriptive_name,
              customer_client.manager,
              customer_client.hidden,
              customer_client.level,
              customer_client.status
       FROM customer_client
       WHERE customer_client.status != 'CLOSED'`
    )
    const rows = (result.results || []) as Array<Record<string, Record<string, unknown>>>
    return rows.map(r => {
      const cc = r.customer_client || r.customerClient || {}
      return {
        id: String(cc.id || ''),
        name: String(cc.descriptiveName || cc.descriptive_name || 'Unnamed'),
        isManager: Boolean(cc.manager),
        hidden: Boolean(cc.hidden),
        status: String(cc.status || 'UNKNOWN'),
        level: Number(cc.level || 0),
      }
    }).filter(r => r.id)
  }

  /**
   * Get customer client accounts under MCC.
   *
   * Strategy:
   * 1. If the configured customerId is an MCC, walk its customer_client tree
   *    so sub-accounts surface even when they aren't directly OAuth-linked
   *    to the calling user.
   * 2. Otherwise (or if the MCC query fails — e.g. wrong login-customer-id,
   *    no manager privilege), fall back to listAccessibleCustomers + a per
   *    account `customer` describe.
   */
  async getClientAccounts(): Promise<Array<{ id: string; name: string; isManager: boolean }>> {
    const mccId = (this.config.customerId || '').replace(/[-\s]/g, '')

    if (mccId) {
      try {
        const clients = await this.listMccClients(mccId)
        if (clients.length > 0) {
          return clients
            .filter(c => !c.hidden)
            .map(c => ({ id: c.id, name: c.name, isManager: c.isManager }))
        }
      } catch {
        // fall through to legacy listAccessibleCustomers
      }
    }

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

  /**
   * Create an ad group inside an existing campaign. Defaults the bid type
   * to MANUAL_CPC + cpcBidMicros = $1 unless caller provides otherwise; that
   * matches what most "starter" campaigns expect and keeps the Display
   * channel from rejecting the create.
   */
  async createAdGroup(
    customerId: string,
    params: { campaignId: string; name: string; cpcBidMicros?: number; status?: 'ENABLED' | 'PAUSED' }
  ) {
    const cid = customerId.replace(/[-\s]/g, '')
    const res = await fetch(`${ADS_API_BASE}/customers/${cid}/adGroups:mutate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        operations: [
          {
            create: {
              name: params.name,
              campaign: `customers/${cid}/campaigns/${params.campaignId}`,
              status: params.status || 'PAUSED',
              type: 'DISPLAY_STANDARD',
              cpcBidMicros: String(params.cpcBidMicros ?? 1_000_000),
            },
          },
        ],
      }),
    })
    const result = await safeJson(res)
    if (!result.ok) {
      throw new Error(
        `Google createAdGroup ${result.status}: ${result.text.substring(0, 300)}`
      )
    }
    return result.data as { results?: Array<{ resourceName?: string }> } | null
  }

  /**
   * Create a responsive display ad inside an ad group. Headline + description
   * are required by Google's API; we pass single-element arrays for the
   * minimal viable payload.
   */
  async createAd(
    customerId: string,
    params: {
      adGroupId: string
      name?: string
      headline: string
      description: string
      finalUrl: string
      businessName?: string
      marketingImageUrl?: string
      squareMarketingImageUrl?: string
      logoImageUrl?: string
    }
  ) {
    const cid = customerId.replace(/[-\s]/g, '')
    const adGroupResource = `customers/${cid}/adGroups/${params.adGroupId}`
    const responsiveDisplayAd: Record<string, unknown> = {
      headlines: [{ text: params.headline.slice(0, 30) }],
      descriptions: [{ text: params.description.slice(0, 90) }],
      longHeadline: { text: params.headline.slice(0, 90) },
      businessName: params.businessName || params.headline.slice(0, 25),
    }
    if (params.marketingImageUrl) {
      responsiveDisplayAd.marketingImages = [{ asset: params.marketingImageUrl }]
    }
    if (params.squareMarketingImageUrl) {
      responsiveDisplayAd.squareMarketingImages = [{ asset: params.squareMarketingImageUrl }]
    }
    if (params.logoImageUrl) {
      responsiveDisplayAd.logoImages = [{ asset: params.logoImageUrl }]
    }
    const res = await fetch(`${ADS_API_BASE}/customers/${cid}/adGroupAds:mutate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        operations: [
          {
            create: {
              adGroup: adGroupResource,
              status: 'PAUSED',
              ad: {
                name: params.name,
                finalUrls: [params.finalUrl],
                responsiveDisplayAd,
              },
            },
          },
        ],
      }),
    })
    const result = await safeJson(res)
    if (!result.ok) {
      throw new Error(
        `Google createAd ${result.status}: ${result.text.substring(0, 300)}`
      )
    }
    return result.data as { results?: Array<{ resourceName?: string }> } | null
  }
}
