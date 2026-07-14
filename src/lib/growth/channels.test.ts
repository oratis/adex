import { describe, it, expect } from 'vitest'
import { CHANNELS, isChannel, isPaidChannel, isSkanChannel, resolveChannel, resolveAdjustChannel, channelToPlatform } from './channels'

describe('channel classification', () => {
  it('paid channels are flagged, earned are not', () => {
    expect(isPaidChannel(CHANNELS.PAID_META_WEB)).toBe(true)
    expect(isPaidChannel(CHANNELS.PAID_ASA)).toBe(true)
    expect(isPaidChannel(CHANNELS.KOL)).toBe(false)
    expect(isPaidChannel(CHANNELS.ORGANIC)).toBe(false)
  })
  it('only iOS social placements are SKAN (ASA is self-attributing)', () => {
    expect(isSkanChannel(CHANNELS.PAID_META_IOS)).toBe(true)
    expect(isSkanChannel(CHANNELS.PAID_TIKTOK_IOS)).toBe(true)
    expect(isSkanChannel(CHANNELS.PAID_ASA)).toBe(false)
    expect(isSkanChannel(CHANNELS.PAID_META_WEB)).toBe(false)
  })
  it('isChannel guards unknown strings', () => {
    expect(isChannel('paid_meta_web')).toBe(true)
    expect(isChannel('nonsense')).toBe(false)
  })
})

describe('resolveChannel — UTM convention adex_{arm}', () => {
  it('web-funnel arms attribute deterministically', () => {
    expect(resolveChannel({ utmSource: 'adex_meta_web' })).toEqual({
      channel: CHANNELS.PAID_META_WEB,
      confidence: 'deterministic',
    })
    expect(resolveChannel({ utmSource: 'adex_tiktok_web' }).channel).toBe(CHANNELS.PAID_TIKTOK_WEB)
  })
  it('ASA attributes deterministically (self-attributing)', () => {
    expect(resolveChannel({ utmSource: 'adex_asa' })).toEqual({
      channel: CHANNELS.PAID_ASA,
      confidence: 'deterministic',
    })
  })
  it('iOS SKAN arms carry a skan confidence flag, not deterministic', () => {
    expect(resolveChannel({ utmSource: 'adex_meta_ios' })).toEqual({
      channel: CHANNELS.PAID_META_IOS,
      confidence: 'skan',
    })
  })
  it('is case-insensitive and trims', () => {
    expect(resolveChannel({ utmSource: '  ADEX_META_WEB ' }).channel).toBe(CHANNELS.PAID_META_WEB)
  })
  it('unrecognized adex_ arm falls back to organic/inferred', () => {
    expect(resolveChannel({ utmSource: 'adex_snapchat' })).toEqual({
      channel: CHANNELS.ORGANIC,
      confidence: 'inferred',
    })
  })
  it('bare earned sources map to their channel', () => {
    expect(resolveChannel({ utmSource: 'kol' }).channel).toBe(CHANNELS.KOL)
    expect(resolveChannel({ utmSource: 'referral' }).channel).toBe(CHANNELS.REFERRAL)
  })
  it('no utm = organic deterministic; unknown utm = organic inferred', () => {
    expect(resolveChannel({})).toEqual({ channel: CHANNELS.ORGANIC, confidence: 'deterministic' })
    expect(resolveChannel({ utmSource: null })).toEqual({ channel: CHANNELS.ORGANIC, confidence: 'deterministic' })
    expect(resolveChannel({ utmSource: 'mystery' })).toEqual({ channel: CHANNELS.ORGANIC, confidence: 'inferred' })
  })
})

describe('resolveAdjustChannel — MMP network_name mapping', () => {
  it('maps Apple Search Ads deterministically', () => {
    expect(resolveAdjustChannel('Apple Search Ads')).toEqual({
      channel: CHANNELS.PAID_ASA,
      confidence: 'deterministic',
    })
  })
  it('maps Meta/TikTok install networks to the iOS SKAN channel (conservative app-install default)', () => {
    expect(resolveAdjustChannel('Facebook Installs')).toEqual({
      channel: CHANNELS.PAID_META_IOS,
      confidence: 'skan',
    })
    expect(resolveAdjustChannel('Instagram Installs').channel).toBe(CHANNELS.PAID_META_IOS)
    expect(resolveAdjustChannel('TikTok Installs')).toEqual({
      channel: CHANNELS.PAID_TIKTOK_IOS,
      confidence: 'skan',
    })
  })
  it('is case-insensitive on network name', () => {
    expect(resolveAdjustChannel('APPLE SEARCH ADS').channel).toBe(CHANNELS.PAID_ASA)
  })
  it('prefers a web-funnel hint in campaign_name over the app-install default', () => {
    expect(resolveAdjustChannel('Facebook Installs', 'Q3 Web Retargeting')).toEqual({
      channel: CHANNELS.PAID_META_WEB,
      confidence: 'inferred',
    })
    expect(resolveAdjustChannel('TikTok Installs', 'web-lander-us').channel).toBe(CHANNELS.PAID_TIKTOK_WEB)
  })
  it('unmapped network names fall back to organic/inferred, never a paid channel', () => {
    expect(resolveAdjustChannel('Some Unknown Network')).toEqual({
      channel: CHANNELS.ORGANIC,
      confidence: 'inferred',
    })
    expect(resolveAdjustChannel(null)).toEqual({ channel: CHANNELS.ORGANIC, confidence: 'inferred' })
  })
  it('explicit organic network is deterministic', () => {
    expect(resolveAdjustChannel('organic')).toEqual({ channel: CHANNELS.ORGANIC, confidence: 'deterministic' })
  })
})

describe('channelToPlatform — bi §7 funnel↔spend join key', () => {
  it('maps paid channels to their ad-platform string', () => {
    expect(channelToPlatform(CHANNELS.PAID_GOOGLE_UAC)).toBe('google')
    expect(channelToPlatform(CHANNELS.PAID_META_WEB)).toBe('meta')
    expect(channelToPlatform(CHANNELS.PAID_META_IOS)).toBe('meta')
    expect(channelToPlatform(CHANNELS.PAID_TIKTOK_WEB)).toBe('tiktok')
    expect(channelToPlatform(CHANNELS.PAID_TIKTOK_IOS)).toBe('tiktok')
    expect(channelToPlatform(CHANNELS.PAID_ASA)).toBe('apple_search_ads')
  })
  it('earned/organic channels have no ad platform — null, not guessed', () => {
    expect(channelToPlatform(CHANNELS.ORGANIC)).toBeNull()
    expect(channelToPlatform(CHANNELS.KOL)).toBeNull()
    expect(channelToPlatform(CHANNELS.REFERRAL)).toBeNull()
    expect(channelToPlatform(CHANNELS.SEO)).toBeNull()
    expect(channelToPlatform(CHANNELS.ASO)).toBeNull()
  })
  it('unrecognized channel strings are null, never throw', () => {
    expect(channelToPlatform('not_a_channel')).toBeNull()
    expect(channelToPlatform('')).toBeNull()
  })
})
