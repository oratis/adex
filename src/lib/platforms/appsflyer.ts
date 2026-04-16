export interface AppsFlyerConfig {
  apiToken: string
  appId: string
}

const BASE_URL = 'https://hq1.appsflyer.com/api'

export class AppsFlyerClient {
  private config: AppsFlyerConfig

  constructor(config: AppsFlyerConfig) {
    this.config = config
  }

  async getInstallReport(startDate: string, endDate: string) {
    const response = await fetch(
      `${BASE_URL}/agg-data/export/app/${this.config.appId}/partners_report/v5?from=${startDate}&to=${endDate}&groupings=date,pid&kpis=impressions,clicks,installs,sessions,revenue,cost`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Accept': 'application/json',
        },
      }
    )
    return response.json()
  }

  async getRetentionReport(startDate: string, endDate: string) {
    const response = await fetch(
      `${BASE_URL}/agg-data/export/app/${this.config.appId}/retention_report/v5?from=${startDate}&to=${endDate}&groupings=date`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Accept': 'application/json',
        },
      }
    )
    return response.json()
  }

  async getEventReport(startDate: string, endDate: string, eventName: string) {
    const response = await fetch(
      `${BASE_URL}/agg-data/export/app/${this.config.appId}/in_app_events_report/v5?from=${startDate}&to=${endDate}&event_name=${eventName}&groupings=date,pid`,
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
