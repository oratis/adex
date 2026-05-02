export interface TikTokAdsConfig {
  accessToken: string
  advertiserId: string
  appId?: string
  secret?: string
}

const BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

export class TikTokAdsClient {
  private config: TikTokAdsConfig

  constructor(config: TikTokAdsConfig) {
    this.config = config
  }

  // Public for adapter use (audit High #10).
  get authHeaders(): Record<string, string> {
    return {
      'Access-Token': this.config.accessToken,
      'Content-Type': 'application/json',
    }
  }

  private get headers() {
    return this.authHeaders
  }

  async getCampaigns() {
    const response = await fetch(
      `${BASE_URL}/campaign/get/?advertiser_id=${this.config.advertiserId}`,
      { headers: this.headers }
    )
    return response.json()
  }

  async createCampaign(params: {
    name: string
    objective: string
    budget: number
    budgetMode: 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL'
  }) {
    const response = await fetch(`${BASE_URL}/campaign/create/`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        advertiser_id: this.config.advertiserId,
        campaign_name: params.name,
        objective_type: params.objective,
        budget: params.budget,
        budget_mode: params.budgetMode,
      }),
    })
    return response.json()
  }

  async createAdGroup(params: {
    campaignId: string
    name: string
    budget: number
    placements: string[]
    targeting: {
      locations?: string[]
      age?: string[]
      gender?: string
      interests?: string[]
    }
    startTime?: string
    endTime?: string
  }) {
    const response = await fetch(`${BASE_URL}/adgroup/create/`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        advertiser_id: this.config.advertiserId,
        campaign_id: params.campaignId,
        adgroup_name: params.name,
        budget: params.budget,
        placement_type: 'PLACEMENT_TYPE_NORMAL',
        placements: params.placements,
        location_ids: params.targeting.locations,
        age_groups: params.targeting.age,
        gender: params.targeting.gender,
        interest_category_ids: params.targeting.interests,
        schedule_start_time: params.startTime,
        schedule_end_time: params.endTime,
        billing_event: 'CPC',
        bid_type: 'BID_TYPE_NO_BID',
      }),
    })
    return response.json()
  }

  async getReport(startDate: string, endDate: string) {
    const response = await fetch(`${BASE_URL}/report/integrated/get/`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        advertiser_id: this.config.advertiserId,
        report_type: 'BASIC',
        dimensions: ['stat_time_day'],
        data_level: 'AUCTION_ADVERTISER',
        start_date: startDate,
        end_date: endDate,
        metrics: ['spend', 'impressions', 'clicks', 'conversion', 'cost_per_conversion', 'ctr', 'cpc'],
      }),
    })
    return response.json()
  }

  async updateCampaignStatus(campaignId: string, status: 'ENABLE' | 'DISABLE') {
    const response = await fetch(`${BASE_URL}/campaign/status/update/`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        advertiser_id: this.config.advertiserId,
        campaign_ids: [campaignId],
        opt_status: status,
      }),
    })
    return response.json()
  }
}
