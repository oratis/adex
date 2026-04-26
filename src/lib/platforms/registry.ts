import type { PlatformAuth } from '@/generated/prisma/client'
import { GoogleAdsAdapter } from './google-adapter'
import { MetaAdsAdapter } from './meta-adapter'
import { TikTokAdsAdapter } from './tiktok-adapter'
import { AmazonAdsAdapter } from './amazon-adapter'
import { LinkedInAdsAdapter } from './linkedin-adapter'
import type { AdapterFactoryInput, PlatformAdapter, PlatformName } from './adapter'

const ADAPTABLE_PLATFORMS: PlatformName[] = ['google', 'meta', 'tiktok', 'amazon', 'linkedin']

export function isAdaptablePlatform(p: string): p is PlatformName {
  return (ADAPTABLE_PLATFORMS as string[]).includes(p)
}

function authToInput(auth: PlatformAuth): AdapterFactoryInput {
  return {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    accountId: auth.accountId,
    appId: auth.appId,
    appSecret: auth.appSecret,
    apiKey: auth.apiKey,
    authId: auth.id,
  }
}

/**
 * Build a PlatformAdapter for a given platform/auth pair. Throws if the
 * platform is not yet adaptable (e.g. Amazon/LinkedIn still on legacy
 * client-only flow).
 */
export function getAdapter(platform: string, auth: PlatformAuth): PlatformAdapter {
  const input = authToInput(auth)
  switch (platform) {
    case 'google':
      return new GoogleAdsAdapter(input)
    case 'meta':
      return new MetaAdsAdapter(input)
    case 'tiktok':
      return new TikTokAdsAdapter(input)
    case 'amazon':
      return new AmazonAdsAdapter(input)
    case 'linkedin':
      return new LinkedInAdsAdapter(input)
    default:
      throw new Error(`No adapter registered for platform "${platform}"`)
  }
}
