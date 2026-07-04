/**
 * Campaign objective resolution + launch validation (pure). The launch route
 * calls this before invoking a PlatformAdapter: it maps our neutral objective
 * to the platform-specific one and enforces app-install / web-conversion
 * requirements and the SKAN iOS campaign-count limit.
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §5.2 (SKAN constraints)
 */

export type CampaignObjective =
  | 'awareness'
  | 'consideration'
  | 'conversion'
  | 'app_install'
  | 'web_conversion'

export type AdPlatform = 'google' | 'meta' | 'tiktok'

// Meta caps iOS SKAdNetwork campaigns per app (commonly 9). TikTok similar.
export const SKAN_IOS_CAMPAIGN_LIMIT: Record<AdPlatform, number> = {
  meta: 9,
  tiktok: 11,
  google: 9,
}

const OBJECTIVE_MAP: Record<AdPlatform, Partial<Record<CampaignObjective, string>>> = {
  meta: {
    awareness: 'OUTCOME_AWARENESS',
    consideration: 'OUTCOME_TRAFFIC',
    conversion: 'OUTCOME_SALES',
    web_conversion: 'OUTCOME_SALES',
    app_install: 'OUTCOME_APP_PROMOTION',
  },
  tiktok: {
    awareness: 'REACH',
    consideration: 'TRAFFIC',
    conversion: 'WEB_CONVERSIONS',
    web_conversion: 'WEB_CONVERSIONS',
    app_install: 'APP_PROMOTION',
  },
  google: {
    awareness: 'DISPLAY',
    consideration: 'SEARCH',
    conversion: 'SEARCH',
    web_conversion: 'SEARCH',
    app_install: 'MULTI_CHANNEL', // App campaign
  },
}

/** Resolve our objective to the platform's objective string. Throws if unsupported. */
export function resolvePlatformObjective(platform: AdPlatform, objective: CampaignObjective): string {
  const mapped = OBJECTIVE_MAP[platform]?.[objective]
  if (!mapped) throw new Error(`objective "${objective}" not supported on ${platform}`)
  return mapped
}

export interface PromotedAppRef {
  platform: string // ios | android | web
  bundleId?: string | null
  storeId?: string | null
  deepLinkDomain?: string | null
}

export interface LaunchValidation {
  ok: boolean
  errors: string[]
}

/**
 * Validate a campaign launch. Enforces:
 *  - app_install requires a PromotedApp with a bundleId or storeId
 *  - iOS app_install on meta/tiktok/google respects the SKAN campaign cap
 *  - web_conversion requires a destination domain (own or the app's deep-link domain)
 */
export function validateLaunch(params: {
  platform: AdPlatform
  objective: CampaignObjective
  promotedApp?: PromotedAppRef | null
  /** existing active iOS SKAN campaigns for this app on this platform */
  existingIosCampaignCount?: number
  destinationDomain?: string | null
}): LaunchValidation {
  const errors: string[] = []
  const { platform, objective, promotedApp } = params

  if (objective === 'app_install') {
    if (!promotedApp) {
      errors.push('app_install requires a promoted app')
    } else if (!promotedApp.bundleId && !promotedApp.storeId) {
      errors.push('promoted app needs a bundleId or storeId')
    }
    if (promotedApp?.platform === 'ios') {
      const limit = SKAN_IOS_CAMPAIGN_LIMIT[platform]
      const count = params.existingIosCampaignCount ?? 0
      if (count >= limit) {
        errors.push(`SKAN iOS campaign limit reached for ${platform} (${count}/${limit})`)
      }
    }
  }

  if (objective === 'web_conversion') {
    const domain = params.destinationDomain ?? promotedApp?.deepLinkDomain
    if (!domain) errors.push('web_conversion requires a destination domain')
  }

  // Resolving throws if the platform can't express the objective.
  try {
    resolvePlatformObjective(platform, objective)
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'unsupported objective')
  }

  return { ok: errors.length === 0, errors }
}
