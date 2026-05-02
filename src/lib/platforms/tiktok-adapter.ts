import { TikTokAdsClient } from './tiktok'
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

// TikTok uses ENABLE/DISABLE for status update API, but READS use STATUS_DELIVERY_OK / STATUS_DISABLE etc.
const TIKTOK_STATUS_MAP: Record<DesiredStatus, 'ENABLE' | 'DISABLE'> = {
  active: 'ENABLE',
  paused: 'DISABLE',
  archived: 'DISABLE',
}

function fromTikTokStatus(s: string | undefined): SyncedStatus {
  if (!s) return 'unknown'
  if (s.includes('DELIVERY_OK') || s.includes('LIVE')) return 'active'
  if (s.includes('DISABLE')) return 'paused'
  if (s.includes('DELETE')) return 'removed'
  if (s.includes('AUDIT') || s.includes('PENDING')) return 'pending'
  return 'unknown'
}

const TIKTOK_GENDER_MAP: Record<string, string> = {
  male: 'GENDER_MALE',
  female: 'GENDER_FEMALE',
  all: 'GENDER_UNLIMITED',
}

export class TikTokAdsAdapter extends BaseAdapter {
  readonly platform = 'tiktok' as const
  readonly accountId: string
  private client: TikTokAdsClient

  constructor(input: AdapterFactoryInput) {
    super(input.authId)
    if (!input.accessToken || !input.accountId) {
      throw new PlatformError(
        'invalid_argument',
        'TikTok adapter requires accessToken + accountId',
        'tiktok'
      )
    }
    this.accountId = input.accountId
    this.client = new TikTokAdsClient({
      accessToken: input.accessToken,
      advertiserId: input.accountId,
      appId: input.appId || undefined,
      secret: input.appSecret || undefined,
    })
  }

  async launchCampaign(input: LaunchCampaignInput): Promise<LaunchResult> {
    const raw = (await safeCall(this.platform, () =>
      this.client.createCampaign({
        name: input.name,
        objective: input.objective || 'REACH',
        budget: input.dailyBudget || input.lifetimeBudget || 50,
        budgetMode: input.dailyBudget ? 'BUDGET_MODE_DAY' : 'BUDGET_MODE_TOTAL',
      })
    )) as { code?: number; message?: string; data?: { campaign_id?: string } } | null
    if (raw?.code && raw.code !== 0) {
      throw new PlatformError(
        'invalid_argument',
        raw.message || 'TikTok launch failed',
        'tiktok',
        undefined,
        raw
      )
    }
    const id = raw?.data?.campaign_id
    if (!id) {
      throw new PlatformError('unknown', 'TikTok launch returned no id', 'tiktok', undefined, raw)
    }
    return { platformCampaignId: id, raw }
  }

  async updateCampaignStatus(platformCampaignId: string, status: DesiredStatus): Promise<void> {
    await safeCall(this.platform, () =>
      this.client.updateCampaignStatus(platformCampaignId, TIKTOK_STATUS_MAP[status])
    )
  }

  async updateCampaignBudget(platformCampaignId: string, dailyBudget: number): Promise<void> {
    await safeCall(this.platform, async () => {
      const res = await fetch(
        'https://business-api.tiktok.com/open_api/v1.3/campaign/update/',
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            advertiser_id: this.accountId,
            campaign_id: platformCampaignId,
            budget: dailyBudget,
          }),
        }
      )
      const data = (await res.json()) as { code?: number; message?: string }
      if (!res.ok || (data.code !== undefined && data.code !== 0)) {
        throw new Error(data.message || `TikTok budget update failed (${res.status})`)
      }
    })
  }

  async createAdGroup(input: CreateAdGroupInput) {
    const raw = (await safeCall(this.platform, () =>
      this.client.createAdGroup({
        campaignId: input.platformCampaignId,
        name: input.name,
        budget: input.dailyBudget || 10,
        placements: ['PLACEMENT_TIKTOK'],
        targeting: {
          locations: input.targetCountries,
          gender: input.gender ? TIKTOK_GENDER_MAP[input.gender] : undefined,
        },
        startTime: input.startDate,
        endTime: input.endDate,
      })
    )) as { code?: number; message?: string; data?: { adgroup_id?: string } } | null
    if (raw?.code && raw.code !== 0) {
      throw new PlatformError(
        'invalid_argument',
        raw.message || 'TikTok createAdGroup failed',
        'tiktok',
        undefined,
        raw
      )
    }
    const id = raw?.data?.adgroup_id
    if (!id) {
      throw new PlatformError(
        'unknown',
        'TikTok createAdGroup returned no id',
        'tiktok',
        undefined,
        raw
      )
    }
    return { platformAdGroupId: id, raw }
  }

  async uploadCreativeAsset(input: import('./adapter').UploadCreativeInput): Promise<import('./adapter').UploadCreativeResult> {
    return safeCall(this.platform, async () => {
      // TikTok requires multipart upload — easier path: their `upload_type=UPLOAD_BY_URL`
      // accepts a remote URL and the asset is fetched server-side. Endpoint:
      //   image: /file/image/ad/upload/
      //   video: /file/video/ad/upload/
      const endpoint = input.type === 'image' ? 'file/image/ad/upload/' : 'file/video/ad/upload/'
      const res = await fetch(`https://business-api.tiktok.com/open_api/v1.3/${endpoint}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          advertiser_id: this.accountId,
          upload_type: 'UPLOAD_BY_URL',
          [input.type === 'image' ? 'image_url' : 'video_url']: input.fileUrl,
          file_name: input.name,
        }),
      })
      const data = (await res.json()) as {
        code?: number
        message?: string
        data?: { image_id?: string; video_id?: string; material_id?: string }
      }
      if (data.code !== undefined && data.code !== 0)
        throw new Error(data.message || 'TikTok upload failed')
      const id = data.data?.image_id || data.data?.video_id || data.data?.material_id
      if (!id) throw new Error('TikTok upload returned no asset id')
      return { platformAssetId: id, raw: data }
    })
  }

  async fetchCampaignList(): Promise<PlatformCampaignSnapshot[]> {
    const data = (await safeCall(this.platform, () => this.client.getCampaigns())) as {
      code?: number
      message?: string
      data?: { list?: Array<Record<string, unknown>> }
    }
    if (data.code !== undefined && data.code !== 0) {
      throw new PlatformError(
        'unknown',
        data.message || 'TikTok getCampaigns failed',
        'tiktok',
        undefined,
        data
      )
    }
    return (data.data?.list || []).map((c) => ({
      platformCampaignId: String(c.campaign_id || ''),
      name: String(c.campaign_name || ''),
      status: fromTikTokStatus(c.operation_status as string | undefined),
      dailyBudget: c.budget ? Number(c.budget) : undefined,
      raw: c,
    }))
  }

  async fetchAccountReport(range: DateRange): Promise<AccountReport> {
    const data = (await safeCall(this.platform, () =>
      this.client.getReport(range.startDate, range.endDate)
    )) as { code?: number; message?: string; data?: { list?: Array<Record<string, unknown>> } }
    if (data.code !== undefined && data.code !== 0) {
      throw new PlatformError(
        'unknown',
        data.message || 'TikTok getReport failed',
        'tiktok',
        undefined,
        data
      )
    }
    const acc: AccountReport = { impressions: 0, clicks: 0, conversions: 0, spend: 0, revenue: 0 }
    for (const row of data.data?.list || []) {
      const m = (row.metrics as Record<string, unknown>) || row
      acc.impressions += Number(m.impressions || 0)
      acc.clicks += Number(m.clicks || 0)
      acc.spend += Number(m.spend || 0)
      acc.conversions += Number(m.conversion || 0)
    }
    return acc
  }

  async fetchCampaignReport(range: DateRange): Promise<CampaignReport[]> {
    return safeCall(this.platform, async () => {
      const res = await fetch(
        'https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/',
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            advertiser_id: this.accountId,
            report_type: 'BASIC',
            dimensions: ['campaign_id', 'stat_time_day'],
            data_level: 'AUCTION_CAMPAIGN',
            start_date: range.startDate,
            end_date: range.endDate,
            metrics: ['campaign_name', 'spend', 'impressions', 'clicks', 'conversion'],
          }),
        }
      )
      const data = (await res.json()) as {
        code?: number
        message?: string
        data?: { list?: Array<Record<string, unknown>> }
      }
      if (data.code !== undefined && data.code !== 0) {
        throw new Error(data.message || 'TikTok campaign report failed')
      }
      return (data.data?.list || []).map((row) => {
        const dims = (row.dimensions as Record<string, unknown>) || {}
        const m = (row.metrics as Record<string, unknown>) || {}
        return {
          platformCampaignId: String(dims.campaign_id || ''),
          campaignName: String(m.campaign_name || ''),
          date: String(dims.stat_time_day || range.endDate).slice(0, 10),
          impressions: Number(m.impressions || 0),
          clicks: Number(m.clicks || 0),
          conversions: Number(m.conversion || 0),
          spend: Number(m.spend || 0),
          revenue: 0,
        }
      })
    })
  }

  // Audit High #10 — uses public TikTokAdsClient.authHeaders getter.
  private headers(): Record<string, string> {
    return this.client.authHeaders
  }
}
