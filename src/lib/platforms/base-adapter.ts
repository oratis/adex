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
 *
 * Audit Med #25: previously the code-mapping was a substring match against
 * the error message, which produced false positives (e.g. an error
 * containing "404" inside a sub-id, or "invalid" inside a description).
 * Anchored regex matches make the inference more reliable. We also try to
 * read a numeric `status` / `statusCode` property if present, which most
 * fetch wrappers expose.
 */
type WithStatus = { status?: unknown; statusCode?: unknown }

function extractStatus(err: unknown): number | null {
  const obj = err as WithStatus | null
  if (!obj) return null
  const s = typeof obj.status === 'number' ? obj.status : obj.statusCode
  return typeof s === 'number' && Number.isFinite(s) ? s : null
}

function codeFromStatus(status: number): PlatformError['code'] | null {
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth_expired'
  if (status === 404) return 'not_found'
  if (status >= 500) return 'platform_outage'
  if (status >= 400) return 'invalid_argument'
  return null
}

export async function safeCall<T>(
  platform: PlatformName,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof PlatformError) throw err
    const message = err instanceof Error ? err.message : String(err)
    let code: PlatformError['code'] = 'unknown'

    // Prefer a structured HTTP status if the wrapper exposed one.
    const status = extractStatus(err)
    if (status != null) {
      const mapped = codeFromStatus(status)
      if (mapped) code = mapped
    }

    // Otherwise fall back to anchored regex matches on the message —
    // tighter than the previous substring includes() to avoid false
    // positives like "404" appearing inside an id.
    if (code === 'unknown') {
      if (/\b429\b|\brate[\s-]?limit/i.test(message)) code = 'rate_limit'
      else if (/\b401\b|\b403\b|expired token|refresh token|unauthor/i.test(message))
        code = 'auth_expired'
      else if (/\b404\b|not[\s-]?found|does not exist/i.test(message)) code = 'not_found'
      else if (/\b5\d\d\b|server error|service unavailable|bad gateway/i.test(message))
        code = 'platform_outage'
      else if (/\b400\b|invalid (argument|parameter|request)|bad request/i.test(message))
        code = 'invalid_argument'
    }

    throw new PlatformError(code, message, platform)
  }
}

export function toPlatformDate(d: Date | string | undefined, fallback: Date = new Date()): string {
  if (!d) return fallback.toISOString().split('T')[0]
  if (typeof d === 'string') return d.split('T')[0]
  return d.toISOString().split('T')[0]
}
