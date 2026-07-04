import { describe, it, expect } from 'vitest'
import { resolvePlatformObjective, validateLaunch, SKAN_IOS_CAMPAIGN_LIMIT } from './campaign-objective'

describe('resolvePlatformObjective', () => {
  it('maps app_install per platform', () => {
    expect(resolvePlatformObjective('meta', 'app_install')).toBe('OUTCOME_APP_PROMOTION')
    expect(resolvePlatformObjective('tiktok', 'app_install')).toBe('APP_PROMOTION')
    expect(resolvePlatformObjective('google', 'app_install')).toBe('MULTI_CHANNEL')
  })
  it('maps web_conversion', () => {
    expect(resolvePlatformObjective('meta', 'web_conversion')).toBe('OUTCOME_SALES')
    expect(resolvePlatformObjective('tiktok', 'web_conversion')).toBe('WEB_CONVERSIONS')
  })
})

describe('validateLaunch', () => {
  const iosApp = { platform: 'ios', storeId: '6785787387', deepLinkDomain: 'cuddler.ai' }

  it('passes a valid iOS app_install under the SKAN cap', () => {
    expect(validateLaunch({ platform: 'meta', objective: 'app_install', promotedApp: iosApp, existingIosCampaignCount: 3 }).ok).toBe(true)
  })
  it('rejects app_install without a promoted app', () => {
    const r = validateLaunch({ platform: 'meta', objective: 'app_install' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('requires a promoted app')
  })
  it('rejects a promoted app with no bundleId/storeId', () => {
    const r = validateLaunch({ platform: 'meta', objective: 'app_install', promotedApp: { platform: 'ios' } })
    expect(r.errors.join()).toContain('bundleId or storeId')
  })
  it('enforces the SKAN iOS campaign cap', () => {
    const r = validateLaunch({ platform: 'meta', objective: 'app_install', promotedApp: iosApp, existingIosCampaignCount: SKAN_IOS_CAMPAIGN_LIMIT.meta })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('SKAN iOS campaign limit')
  })
  it('does not apply the SKAN cap to a non-iOS app', () => {
    const android = { platform: 'android', storeId: 'com.cuddler' }
    expect(validateLaunch({ platform: 'meta', objective: 'app_install', promotedApp: android, existingIosCampaignCount: 20 }).ok).toBe(true)
  })
  it('requires a domain for web_conversion, or falls back to the app deep-link domain', () => {
    expect(validateLaunch({ platform: 'meta', objective: 'web_conversion' }).ok).toBe(false)
    expect(validateLaunch({ platform: 'meta', objective: 'web_conversion', destinationDomain: 'cuddler.ai' }).ok).toBe(true)
    expect(validateLaunch({ platform: 'meta', objective: 'web_conversion', promotedApp: iosApp }).ok).toBe(true)
  })
})
