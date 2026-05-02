import { MetaAdsClient } from './meta'
import { BaseAdapter, safeCall } from './base-adapter'
import type {
  AdapterFactoryInput,
  AccountReport,
  CampaignReport,
  CreateAdGroupInput,
  DateRange,
  DesiredStatus,
  LaunchCampaignInput,
  LaunchResult,
  PlatformCampaignSnapshot,
  SyncedStatus,
} from './adapter'
import { PlatformError } from './adapter'

const META_STATUS_MAP: Record<DesiredStatus, 'ACTIVE' | 'PAUSED' | 'ARCHIVED'> = {
  active: 'ACTIVE',
  paused: 'PAUSED',
  archived: 'ARCHIVED',
}

function fromMetaStatus(s: string | undefined): SyncedStatus {
  switch (s) {
    case 'ACTIVE':
      return 'active'
    case 'PAUSED':
      return 'paused'
    case 'ARCHIVED':
      return 'archived'
    case 'DELETED':
      return 'removed'
    case 'PENDING_REVIEW':
    case 'PREAPPROVED':
      return 'pending'
    default:
      return 'unknown'
  }
}

const META_GENDER: Record<string, number[]> = {
  male: [1],
  female: [2],
  all: [1, 2],
}

export class MetaAdsAdapter extends BaseAdapter {
  readonly platform = 'meta' as const
  readonly accountId: string
  private client: MetaAdsClient

  constructor(input: AdapterFactoryInput) {
    super(input.authId)
    if (!input.accessToken || !input.accountId) {
      throw new PlatformError(
        'invalid_argument',
        'Meta adapter requires accessToken + accountId',
        'meta'
      )
    }
    this.accountId = input.accountId.replace(/^act_/, '')
    this.client = new MetaAdsClient({
      accessToken: input.accessToken,
      adAccountId: this.accountId,
      appId: input.appId || undefined,
      appSecret: input.appSecret || undefined,
    })
  }

  async launchCampaign(input: LaunchCampaignInput): Promise<LaunchResult> {
    const raw = (await safeCall(this.platform, () =>
      this.client.createCampaign({
        name: input.name,
        objective: input.objective || 'OUTCOME_AWARENESS',
        status: 'PAUSED',
        dailyBudget: input.dailyBudget,
        lifetimeBudget: input.lifetimeBudget,
        startTime: input.startDate,
        endTime: input.endDate,
      })
    )) as { id?: string; error?: { message?: string } } | null
    if (raw?.error) {
      throw new PlatformError(
        'invalid_argument',
        raw.error.message || 'Meta launch failed',
        'meta',
        undefined,
        raw
      )
    }
    if (!raw?.id) {
      throw new PlatformError('unknown', 'Meta launch returned no id', 'meta', undefined, raw)
    }
    return { platformCampaignId: raw.id, raw }
  }

  async updateCampaignStatus(platformCampaignId: string, status: DesiredStatus): Promise<void> {
    const apiStatus = META_STATUS_MAP[status]
    // The existing client only types ACTIVE | PAUSED — cast for ARCHIVED.
    await safeCall(this.platform, () =>
      this.client.updateCampaignStatus(platformCampaignId, apiStatus as 'ACTIVE' | 'PAUSED')
    )
  }

  async updateCampaignBudget(platformCampaignId: string, dailyBudget: number): Promise<void> {
    // Meta lets you POST to /{campaign_id} with new daily_budget (cents).
    await safeCall(this.platform, async () => {
      const body = new URLSearchParams({
        daily_budget: String(Math.round(dailyBudget * 100)),
        access_token: this.tokenForUrl(),
      })
      const res = await fetch(`https://graph.facebook.com/v19.0/${platformCampaignId}`, {
        method: 'POST',
        body,
      })
      const data = (await res.json()) as { error?: { message?: string } }
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || `Meta budget update failed (${res.status})`)
      }
    })
  }

  async createAdGroup(input: CreateAdGroupInput) {
    const targeting = {
      geoLocations: input.targetCountries ? { countries: input.targetCountries } : undefined,
      ageMin: input.ageMin,
      ageMax: input.ageMax,
      genders: input.gender ? META_GENDER[input.gender] : undefined,
    }
    const raw = (await safeCall(this.platform, () =>
      this.client.createAdSet({
        campaignId: input.platformCampaignId,
        name: input.name,
        dailyBudget: input.dailyBudget,
        targeting,
        startTime: input.startDate,
        endTime: input.endDate,
      })
    )) as { id?: string; error?: { message?: string } } | null
    if (raw?.error || !raw?.id) {
      throw new PlatformError(
        'invalid_argument',
        raw?.error?.message || 'Meta createAdSet failed',
        'meta',
        undefined,
        raw
      )
    }
    return { platformAdGroupId: raw.id, raw }
  }

  async uploadCreativeAsset(input: import('./adapter').UploadCreativeInput): Promise<import('./adapter').UploadCreativeResult> {
    return safeCall(this.platform, async () => {
      const token = this.tokenForUrl()
      // Meta accepts a `url` parameter on /adimages — the platform fetches it
      // server-side. /advideos uses `file_url`. Either way we don't need to
      // re-stream the asset from this process.
      if (input.type === 'image') {
        const body = new URLSearchParams({ url: input.fileUrl, access_token: token })
        const res = await fetch(`https://graph.facebook.com/v19.0/act_${this.accountId}/adimages`, {
          method: 'POST',
          body,
        })
        const data = (await res.json()) as { images?: Record<string, { hash?: string }>; error?: { message?: string } }
        if (!res.ok || data.error) throw new Error(data.error?.message || `Meta upload failed (${res.status})`)
        const first = Object.values(data.images || {})[0]
        if (!first?.hash) throw new Error('Meta upload returned no image hash')
        return { platformAssetId: first.hash, raw: data }
      }
      const body = new URLSearchParams({
        file_url: input.fileUrl,
        name: input.name,
        access_token: token,
      })
      const res = await fetch(`https://graph.facebook.com/v19.0/act_${this.accountId}/advideos`, {
        method: 'POST',
        body,
      })
      const data = (await res.json()) as { id?: string; error?: { message?: string } }
      if (!res.ok || data.error) throw new Error(data.error?.message || `Meta video upload failed (${res.status})`)
      if (!data.id) throw new Error('Meta video upload returned no id')
      return { platformAssetId: data.id, raw: data }
    })
  }

  async pauseAd(platformAdId: string): Promise<void> {
    // Meta /{ad_id} POST status=PAUSED
    await safeCall(this.platform, async () => {
      const body = new URLSearchParams({ status: 'PAUSED', access_token: this.tokenForUrl() })
      const res = await fetch(`https://graph.facebook.com/v19.0/${platformAdId}`, {
        method: 'POST',
        body,
      })
      const data = (await res.json()) as { error?: { message?: string } }
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || `Meta pause ad failed (${res.status})`)
      }
    })
  }

  async fetchCampaignList(): Promise<PlatformCampaignSnapshot[]> {
    const data = (await safeCall(this.platform, () => this.client.getCampaigns())) as {
      data?: Array<Record<string, unknown>>
      error?: { message?: string }
    }
    if (data.error) {
      throw new PlatformError(
        'unknown',
        data.error.message || 'Meta getCampaigns failed',
        'meta',
        undefined,
        data
      )
    }
    return (data.data || []).map((c) => ({
      platformCampaignId: String(c.id || ''),
      name: String(c.name || ''),
      status: fromMetaStatus(c.status as string),
      dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : undefined,
      lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : undefined,
      raw: c,
    }))
  }

  async fetchAccountReport(range: DateRange): Promise<AccountReport> {
    const data = (await safeCall(this.platform, () =>
      this.client.getReport(range.startDate, range.endDate)
    )) as { data?: Array<Record<string, unknown>>; error?: { message?: string } }
    if (data.error) {
      throw new PlatformError(
        'unknown',
        data.error.message || 'Meta getReport failed',
        'meta',
        undefined,
        data
      )
    }
    const rows = data.data || []
    const acc: AccountReport = {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      spend: 0,
      revenue: 0,
      installs: 0,
    }
    for (const row of rows) {
      acc.impressions += Number(row.impressions || 0)
      acc.clicks += Number(row.clicks || 0)
      acc.spend += Number(row.spend || 0)
      const actions = Array.isArray(row.actions)
        ? (row.actions as Array<Record<string, unknown>>)
        : []
      for (const a of actions) {
        const t = String(a.action_type || '')
        if (t === 'purchase' || t.includes('conversion')) acc.conversions += Number(a.value || 0)
        if (t === 'mobile_app_install' || t === 'app_install') acc.installs! += Number(a.value || 0)
      }
      const values = Array.isArray(row.action_values)
        ? (row.action_values as Array<Record<string, unknown>>)
        : []
      for (const v of values) {
        const t = String(v.action_type || '')
        if (t === 'purchase' || t.includes('conversion')) acc.revenue += Number(v.value || 0)
      }
    }
    return acc
  }

  async fetchCampaignReport(range: DateRange): Promise<CampaignReport[]> {
    // Existing client only supports account-level insights; for campaign
    // breakdown we fall back to a direct insights call with level=campaign.
    return safeCall(this.platform, async () => {
      const url = `https://graph.facebook.com/v19.0/act_${this.accountId}/insights?level=campaign&fields=impressions,clicks,spend,actions,action_values,campaign_id,campaign_name&time_range=${encodeURIComponent(JSON.stringify({ since: range.startDate, until: range.endDate }))}&time_increment=1&access_token=${this.tokenForUrl()}`
      const res = await fetch(url)
      const data = (await res.json()) as { data?: Array<Record<string, unknown>>; error?: { message?: string } }
      if (data.error) throw new Error(data.error.message)
      return (data.data || []).map((row) => {
        const actions = Array.isArray(row.actions)
          ? (row.actions as Array<Record<string, unknown>>)
          : []
        const values = Array.isArray(row.action_values)
          ? (row.action_values as Array<Record<string, unknown>>)
          : []
        let conversions = 0
        let revenue = 0
        for (const a of actions) {
          const t = String(a.action_type || '')
          if (t === 'purchase' || t.includes('conversion')) conversions += Number(a.value || 0)
        }
        for (const v of values) {
          const t = String(v.action_type || '')
          if (t === 'purchase' || t.includes('conversion')) revenue += Number(v.value || 0)
        }
        return {
          platformCampaignId: String(row.campaign_id || ''),
          campaignName: String(row.campaign_name || ''),
          date: String(row.date_start || range.endDate),
          impressions: Number(row.impressions || 0),
          clicks: Number(row.clicks || 0),
          conversions,
          spend: Number(row.spend || 0),
          revenue,
        }
      })
    })
  }

  // Audit High #10 — uses MetaAdsClient.accessToken public getter
  // instead of the prior `as unknown` private-config cast. Refactor-safe.
  private tokenForUrl(): string {
    return this.client.accessToken
  }
}
