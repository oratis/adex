import { describe, it, expect } from 'vitest'
import { CHANNELS, isChannel, isPaidChannel, isSkanChannel, resolveChannel } from './channels'

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
