import {
  isRecord,
  type AdjustPlan,
  validateRange,
  normalizeAdjustReport,
} from '@/lib/reports/adjust-data'

// Aggregate reports remain separate from user-level ConversionEvent ingestion.
export interface AdjustConfig {
  apiToken: string
  appToken: string
}

export interface AdjustCatalogItem {
  id: string
  name: string
}
export interface AdjustEvent extends AdjustCatalogItem {
  description: string
  formatting: string
  section: string
}

function apiBase() {
  const fixture = process.env.ADJUST_TEST_API_URL
  if (!fixture) return 'https://automate.adjust.com/reports-service'
  const url = new URL(fixture)
  if (
    process.env.NODE_ENV === 'production' ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid Adjust test endpoint')
  return fixture.replace(/\/$/, '')
}

interface AdjustReport {
  rows: Record<string, unknown>[]
  [key: string]: unknown
}

export class AdjustClient {
  private config: AdjustConfig

  constructor(config: AdjustConfig) {
    this.config = config
  }

  async listApps(): Promise<AdjustCatalogItem[]> {
    const data = await this.request('filters_data', {
      required_filters: 'apps',
    })
    if (!isRecord(data) || !Array.isArray(data.apps))
      throw new Error('Invalid Adjust app catalog')
    return data.apps.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.id !== 'string' ||
        typeof item.name !== 'string'
      )
        throw new Error('Invalid Adjust app catalog')
      return { id: item.id, name: item.name }
    })
  }

  async listEvents(): Promise<AdjustEvent[]> {
    const data = await this.request('events', {
      app_token__in: this.config.appToken,
      tokens_mapping: 'true',
    })
    if (!Array.isArray(data)) throw new Error('Invalid Adjust event catalog')
    const events: AdjustEvent[] = []
    for (const event of data) {
      if (
        !isRecord(event) ||
        typeof event.id !== 'string' ||
        typeof event.name !== 'string' ||
        !Array.isArray(event.app_token)
      )
        throw new Error('Invalid Adjust event catalog')
      if (
        !event.app_token.includes(this.config.appToken) ||
        event.is_skad_event === true
      )
        continue
      events.push({
        id: event.id,
        name: event.name,
        description: String(event.description ?? ''),
        formatting: String(event.formatting ?? ''),
        section: String(event.section ?? ''),
      })
    }
    return events
  }

  async getMappedReport(plan: AdjustPlan, startDate: string, endDate: string) {
    validateRange(startDate, endDate)
    if (plan.appToken !== this.config.appToken)
      throw new Error('Adjust app configuration mismatch')
    const parameters = {
      metrics: [
        ...new Set([
          'installs',
          ...Object.values(plan.metrics).map((metric) => metric.id),
        ]),
      ].join(','),
      currency: plan.currency,
      utc_offset: plan.utcOffset,
      attribution_source: plan.attributionSource,
      reattributed: plan.reattributed,
      sandbox: 'false',
      format_dates: 'false',
    }
    const report = await this.requestReport(startDate, endDate, {
      ...parameters,
      dimensions:
        'app_token,os_name,partner,network,ad_account_id,campaign_id_network,campaign_network',
    })
    // Query whole-window unique users separately; dimension rows are not additive.
    const total = await this.requestReport(startDate, endDate, {
      ...parameters,
      dimensions: 'app_token',
    })
    if (report.pagination || total.pagination)
      throw new Error('Adjust report is paginated; narrow the reporting window')
    return {
      ...normalizeAdjustReport(report.rows, total.rows, plan),
      providerWarningCount: [report, total].reduce(
        (n, response) =>
          n + (Array.isArray(response.warnings) ? response.warnings.length : 0),
        0,
      ),
    }
  }

  async getReport(startDate: string, endDate: string) {
    return this.requestReport(startDate, endDate, {
      dimensions: 'day,app',
      metrics: 'installs,clicks,impressions,sessions,revenue,cost',
    })
  }

  async getCohortReport(startDate: string, endDate: string) {
    return this.requestReport(startDate, endDate, {
      dimensions: 'day',
      metrics: 'installs,retained_users,paying_users,revenue',
      cohort_maturity: 'immature',
    })
  }

  private async requestReport(
    startDate: string,
    endDate: string,
    parameters: Record<string, string>,
  ): Promise<AdjustReport> {
    const data = await this.request('report', {
      app_token__in: this.config.appToken,
      date_period: `${startDate}:${endDate}`,
      ...parameters,
    })
    if (
      !isRecord(data) ||
      data.error ||
      !Array.isArray(data.rows) ||
      !data.rows.every(isRecord)
    ) {
      throw new Error('Invalid Adjust report response')
    }
    return { ...data, rows: data.rows }
  }

  private async request(
    endpoint: 'report' | 'events' | 'filters_data',
    parameters: Record<string, string>,
  ): Promise<unknown> {
    const query = new URLSearchParams(parameters)
    const response = await fetch(`${apiBase()}/${endpoint}?${query}`, {
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      throw new Error(`Adjust report request failed (HTTP ${response.status})`)
    }
    if (response.status === 204)
      return endpoint === 'report'
        ? { rows: [] }
        : endpoint === 'events'
          ? []
          : { apps: [] }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new Error('Invalid Adjust report response')
    }
    return data
  }
}
