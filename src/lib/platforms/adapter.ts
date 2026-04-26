/**
 * PlatformAdapter — single abstraction over every ad platform.
 *
 * Adapters wrap the existing platform clients (`google.ts`, `meta.ts`, etc.)
 * with a uniform shape so the launch route, advisor, and Agent runtime can
 * call any platform without branching on platform name.
 *
 * Inputs/outputs use neutral types defined here. Platform-specific quirks
 * stay inside each adapter implementation.
 */

export type PlatformName = 'google' | 'meta' | 'tiktok' | 'amazon' | 'linkedin'

export type EntityType = 'campaign' | 'adgroup' | 'ad' | 'creative'

export type DesiredStatus = 'active' | 'paused' | 'archived'

export type SyncedStatus =
  | 'active'
  | 'paused'
  | 'archived'
  | 'removed'
  | 'pending'
  | 'unknown'

export type DateRange = { startDate: string; endDate: string } // YYYY-MM-DD

export type LaunchCampaignInput = {
  name: string
  objective?: string
  dailyBudget?: number
  lifetimeBudget?: number
  startDate?: string
  endDate?: string
  targetCountries?: string[]
  ageMin?: number
  ageMax?: number
  gender?: 'all' | 'male' | 'female'
  interests?: string[]
}

export type LaunchResult = {
  platformCampaignId: string
  raw: unknown
}

export type CreateAdGroupInput = {
  platformCampaignId: string
  name: string
  dailyBudget?: number
  targetCountries?: string[]
  ageMin?: number
  ageMax?: number
  gender?: 'all' | 'male' | 'female'
  interests?: string[]
  startDate?: string
  endDate?: string
}

export type CreateAdInput = {
  platformAdGroupId: string
  name: string
  headline?: string
  description?: string
  callToAction?: string
  destinationUrl?: string
  creative?: {
    type: 'image' | 'video'
    fileUrl?: string
    width?: number
    height?: number
    duration?: number
    platformAssetId?: string
  }
}

export type UploadCreativeInput = {
  type: 'image' | 'video'
  fileUrl: string
  name: string
  width?: number
  height?: number
  duration?: number
}

export type UploadCreativeResult = {
  platformAssetId: string
  raw: unknown
}

export type PlatformCampaignSnapshot = {
  platformCampaignId: string
  name: string
  status: SyncedStatus
  dailyBudget?: number
  lifetimeBudget?: number
  bidStrategy?: string
  targeting?: unknown
  raw: unknown
}

export type AccountReport = {
  impressions: number
  clicks: number
  conversions: number
  spend: number
  revenue: number
  installs?: number
}

export type CampaignReport = AccountReport & {
  platformCampaignId: string
  date: string // YYYY-MM-DD
  campaignName?: string
}

export type PlatformErrorCode =
  | 'rate_limit'
  | 'auth_expired'
  | 'invalid_argument'
  | 'platform_outage'
  | 'not_found'
  | 'unknown'

export class PlatformError extends Error {
  constructor(
    public code: PlatformErrorCode,
    message: string,
    public readonly platform?: PlatformName,
    public readonly retryAfterSeconds?: number,
    public readonly raw?: unknown
  ) {
    super(message)
    this.name = 'PlatformError'
  }
}

export interface PlatformAdapter {
  readonly platform: PlatformName
  readonly accountId: string

  // ===== Write =====
  launchCampaign(input: LaunchCampaignInput): Promise<LaunchResult>
  updateCampaignStatus(platformCampaignId: string, status: DesiredStatus): Promise<void>
  updateCampaignBudget(platformCampaignId: string, dailyBudget: number): Promise<void>
  createAdGroup(input: CreateAdGroupInput): Promise<{ platformAdGroupId: string; raw: unknown }>
  createAd(input: CreateAdInput): Promise<{ platformAdId: string; raw: unknown }>
  uploadCreativeAsset(input: UploadCreativeInput): Promise<UploadCreativeResult>
  pauseAd(platformAdId: string): Promise<void>

  // ===== Read =====
  fetchCampaignList(): Promise<PlatformCampaignSnapshot[]>
  fetchAccountReport(range: DateRange): Promise<AccountReport>
  fetchCampaignReport(range: DateRange): Promise<CampaignReport[]>

  // ===== Optional housekeeping =====
  refreshAuth?(): Promise<{ accessToken?: string }>
}

export type AdapterCapability =
  | 'launch'
  | 'updateStatus'
  | 'updateBudget'
  | 'createAdGroup'
  | 'createAd'
  | 'uploadCreativeAsset'
  | 'pauseAd'
  | 'fetchCampaignList'
  | 'fetchAccountReport'
  | 'fetchCampaignReport'

export type AdapterFactoryInput = {
  accessToken: string | null
  refreshToken: string | null
  accountId: string | null
  appId: string | null
  appSecret: string | null
  apiKey: string | null
  // PlatformAuth.id — adapters use this to persist refreshed tokens
  authId: string
}
