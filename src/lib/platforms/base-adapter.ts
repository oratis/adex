import { prisma } from '@/lib/prisma'
import {
  AdapterCapability,
  PlatformAdapter,
  PlatformError,
  PlatformName,
  type LaunchCampaignInput,
  type LaunchResult,
  type CreateAdGroupInput,
  type CreateAdInput,
  type DateRange,
  type DesiredStatus,
  type AccountReport,
  type CampaignReport,
  type PlatformCampaignSnapshot,
  type UploadCreativeInput,
  type UploadCreativeResult,
} from './adapter'

/**
 * Default-throwing base. Each concrete adapter overrides what it actually
 * supports; everything else throws PlatformError('not implemented') at the
 * boundary so callers fail loudly instead of silently doing nothing.
 */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly platform: PlatformName
  abstract readonly accountId: string
  protected authId: string

  constructor(authId: string) {
    this.authId = authId
  }

  protected unsupported(cap: AdapterCapability): never {
    throw new PlatformError(
      'invalid_argument',
      `${this.platform} adapter does not implement ${cap}`,
      this.platform
    )
  }

  protected async persistRefreshedToken(token: string): Promise<void> {
    await prisma.platformAuth.update({
      where: { id: this.authId },
      data: { accessToken: token },
    })
  }

  // Default implementations throw — subclasses override.
  async launchCampaign(_input: LaunchCampaignInput): Promise<LaunchResult> {
    return this.unsupported('launch')
  }
  async updateCampaignStatus(_id: string, _status: DesiredStatus): Promise<void> {
    return this.unsupported('updateStatus')
  }
  async updateCampaignBudget(_id: string, _dailyBudget: number): Promise<void> {
    return this.unsupported('updateBudget')
  }
  async createAdGroup(
    _input: CreateAdGroupInput
  ): Promise<{ platformAdGroupId: string; raw: unknown }> {
    return this.unsupported('createAdGroup')
  }
  async createAd(_input: CreateAdInput): Promise<{ platformAdId: string; raw: unknown }> {
    return this.unsupported('createAd')
  }
  async uploadCreativeAsset(_input: UploadCreativeInput): Promise<UploadCreativeResult> {
    return this.unsupported('uploadCreativeAsset')
  }
  async pauseAd(_id: string): Promise<void> {
    return this.unsupported('pauseAd')
  }
  async fetchCampaignList(): Promise<PlatformCampaignSnapshot[]> {
    return this.unsupported('fetchCampaignList')
  }
  async fetchAccountReport(_range: DateRange): Promise<AccountReport> {
    return this.unsupported('fetchAccountReport')
  }
  async fetchCampaignReport(_range: DateRange): Promise<CampaignReport[]> {
    return this.unsupported('fetchCampaignReport')
  }
}

/**
 * Wrap an arbitrary platform-API call so any thrown error becomes a
 * PlatformError with a normalized code. Callers can then decide retry/back-off
 * uniformly across platforms.
 */
export async function safeCall<T>(
  platform: PlatformName,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof PlatformError) throw err
    const message = err instanceof Error ? err.message : String(err)
    const lower = message.toLowerCase()
    let code: PlatformError['code'] = 'unknown'
    if (lower.includes('429') || lower.includes('rate limit')) code = 'rate_limit'
    else if (lower.includes('401') || lower.includes('expired') || lower.includes('refresh'))
      code = 'auth_expired'
    else if (lower.includes('400') || lower.includes('invalid')) code = 'invalid_argument'
    else if (lower.includes('500') || lower.includes('502') || lower.includes('503'))
      code = 'platform_outage'
    else if (lower.includes('404') || lower.includes('not found')) code = 'not_found'
    throw new PlatformError(code, message, platform)
  }
}

export function toPlatformDate(d: Date | string | undefined, fallback: Date = new Date()): string {
  if (!d) return fallback.toISOString().split('T')[0]
  if (typeof d === 'string') return d.split('T')[0]
  return d.toISOString().split('T')[0]
}
