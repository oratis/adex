export interface AdjustConfig {
  apiToken: string
  appToken: string
}

const BASE_URL = 'https://dash.adjust.com'

export class AdjustClient {
  private config: AdjustConfig

  constructor(config: AdjustConfig) {
    this.config = config
  }

  async getReport(startDate: string, endDate: string) {
    const response = await fetch(
      `${BASE_URL}/control-center/reports-service/report?app_token__in=${this.config.appToken}&date_period=${startDate}:${endDate}&dimensions=day,app&metrics=installs,clicks,impressions,sessions,revenue,cost`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Accept': 'application/json',
        },
      }
    )
    return response.json()
  }

  async getCohortReport(startDate: string, endDate: string) {
    const response = await fetch(
      `${BASE_URL}/control-center/reports-service/report?app_token__in=${this.config.appToken}&date_period=${startDate}:${endDate}&dimensions=day&metrics=installs,retained_users,paying_users,revenue&cohort_maturity=immature`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Accept': 'application/json',
        },
      }
    )
    return response.json()
  }
}
