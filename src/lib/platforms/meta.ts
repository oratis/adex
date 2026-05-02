export interface MetaAdsConfig {
  accessToken: string
  adAccountId: string
  appId?: string
  appSecret?: string
}

const META_API_VERSION = 'v19.0'
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

export class MetaAdsClient {
  private config: MetaAdsConfig

  constructor(config: MetaAdsConfig) {
    this.config = config
  }

  // Public access token accessor — used by MetaAdsAdapter for ad-hoc REST
  // calls (budget update, pause ad, asset upload) without the unsafe
  // `as unknown` private-access pattern. Audit High #10.
  get accessToken(): string {
    return this.config.accessToken
  }

  private get headers() {
    return { 'Authorization': `Bearer ${this.config.accessToken}` }
  }

  async getCampaigns() {
    const response = await fetch(
      `${BASE_URL}/act_${this.config.adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time&access_token=${this.config.accessToken}`
    )
    return response.json()
  }

  async createCampaign(params: {
    name: string
    objective: string
    status?: string
    dailyBudget?: number
    lifetimeBudget?: number
    startTime?: string
    endTime?: string
  }) {
    const body = new URLSearchParams({
      name: params.name,
      objective: params.objective.toUpperCase(),
      status: params.status || 'PAUSED',
      special_ad_categories: '[]',
      access_token: this.config.accessToken,
    })
    if (params.dailyBudget) body.set('daily_budget', String(params.dailyBudget * 100))
    if (params.lifetimeBudget) body.set('lifetime_budget', String(params.lifetimeBudget * 100))
    if (params.startTime) body.set('start_time', params.startTime)
    if (params.endTime) body.set('end_time', params.endTime)

    const response = await fetch(
      `${BASE_URL}/act_${this.config.adAccountId}/campaigns`,
      { method: 'POST', body }
    )
    return response.json()
  }

  async createAdSet(params: {
    campaignId: string
    name: string
    dailyBudget?: number
    targeting: {
      geoLocations?: { countries: string[] }
      ageMin?: number
      ageMax?: number
      genders?: number[]
      interests?: { id: string; name: string }[]
    }
    startTime?: string
    endTime?: string
  }) {
    const targeting: Record<string, unknown> = {}
    if (params.targeting.geoLocations) targeting.geo_locations = params.targeting.geoLocations
    if (params.targeting.ageMin) targeting.age_min = params.targeting.ageMin
    if (params.targeting.ageMax) targeting.age_max = params.targeting.ageMax
    if (params.targeting.genders) targeting.genders = params.targeting.genders
    if (params.targeting.interests) targeting.interests = params.targeting.interests

    const body = new URLSearchParams({
      campaign_id: params.campaignId,
      name: params.name,
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'REACH',
      targeting: JSON.stringify(targeting),
      status: 'PAUSED',
      access_token: this.config.accessToken,
    })
    if (params.dailyBudget) body.set('daily_budget', String(params.dailyBudget * 100))

    const response = await fetch(
      `${BASE_URL}/act_${this.config.adAccountId}/adsets`,
      { method: 'POST', body }
    )
    return response.json()
  }

  async getReport(startDate: string, endDate: string) {
    const response = await fetch(
      `${BASE_URL}/act_${this.config.adAccountId}/insights?fields=impressions,clicks,spend,actions,cost_per_action_type,ctr,cpc&time_range={"since":"${startDate}","until":"${endDate}"}&time_increment=1&access_token=${this.config.accessToken}`
    )
    return response.json()
  }

  async updateCampaignStatus(campaignId: string, status: 'ACTIVE' | 'PAUSED') {
    const body = new URLSearchParams({
      status,
      access_token: this.config.accessToken,
    })
    const response = await fetch(`${BASE_URL}/${campaignId}`, { method: 'POST', body })
    return response.json()
  }
}
