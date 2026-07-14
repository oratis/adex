import { describe, it, expect } from 'vitest'
import { parseCampaignName } from './campaign-name'

describe('parseCampaignName — full example', () => {
  it('parses every positional field from the canon example', () => {
    expect(parseCampaignName('inhouse-20260512-mai-Android-US/T1/JP-Google-01-Luddi-install-female-Davis-xx')).toEqual({
      agency: 'inhouse',
      date: '20260512',
      dateRaw: '20260512',
      bidStrategy: 'mai',
      os: 'android',
      osRaw: 'Android',
      regions: ['US', 'T1', 'JP'],
      channelHint: 'Google',
      index: '01',
      product: 'Luddi',
      goal: 'install',
      audience: 'female',
      custom: ['Davis', 'xx'],
    })
  })
})

describe('parseCampaignName — missing/short segments', () => {
  it('fills what it can and leaves the rest null when segments run out', () => {
    expect(parseCampaignName('inhouse-20260512')).toEqual({
      agency: 'inhouse',
      date: '20260512',
      dateRaw: '20260512',
      bidStrategy: null,
      os: null,
      osRaw: null,
      regions: [],
      channelHint: null,
      index: null,
      product: null,
      goal: null,
      audience: null,
      custom: [],
    })
  })

  it('handles exactly one dash (two segments)', () => {
    const parsed = parseCampaignName('agencyname-20260101')
    expect(parsed?.agency).toBe('agencyname')
    expect(parsed?.date).toBe('20260101')
    expect(parsed?.custom).toEqual([])
  })
})

describe('parseCampaignName — extra segments', () => {
  it('collects everything past position 10 into custom, in order', () => {
    const parsed = parseCampaignName('a-20260101-b-ios-US-Meta-01-Prod-signup-male-extra1-extra2-extra3')
    expect(parsed?.custom).toEqual(['extra1', 'extra2', 'extra3'])
  })
})

describe('parseCampaignName — regions', () => {
  it('splits multiple region codes on /', () => {
    const parsed = parseCampaignName('a-20260101-b-ios-US/CA/UK-Meta')
    expect(parsed?.regions).toEqual(['US', 'CA', 'UK'])
  })

  it('single region', () => {
    const parsed = parseCampaignName('a-20260101-b-ios-JP-Meta')
    expect(parsed?.regions).toEqual(['JP'])
  })

  it('missing region segment yields empty array', () => {
    const parsed = parseCampaignName('a-20260101-b-ios')
    expect(parsed?.regions).toEqual([])
  })
})

describe('parseCampaignName — os normalization', () => {
  it('is case-insensitive for known os values', () => {
    expect(parseCampaignName('a-20260101-b-IOS')?.os).toBe('ios')
    expect(parseCampaignName('a-20260101-b-ANDROID')?.os).toBe('android')
    expect(parseCampaignName('a-20260101-b-Web')?.os).toBe('web')
  })

  it('unrecognized os text is null but preserved in osRaw', () => {
    const parsed = parseCampaignName('a-20260101-b-PlayStation')
    expect(parsed?.os).toBeNull()
    expect(parsed?.osRaw).toBe('PlayStation')
  })

  it('missing os segment is null/null', () => {
    const parsed = parseCampaignName('a-20260101')
    expect(parsed?.os).toBeNull()
    expect(parsed?.osRaw).toBeNull()
  })
})

describe('parseCampaignName — date validation', () => {
  it('rejects a non-8-digit date but preserves the raw text', () => {
    const parsed = parseCampaignName('a-2026-05-12-b')
    // "2026" is only 4 digits — invalid, but this also demonstrates that
    // the date segment is strictly the 2nd `-`-delimited segment; extra
    // dashes inside what a human might call "the date" just become more
    // segments, which is expected positional behavior.
    expect(parsed?.date).toBeNull()
    expect(parsed?.dateRaw).toBe('2026')
  })

  it('rejects non-numeric date text', () => {
    const parsed = parseCampaignName('a-notadate-b')
    expect(parsed?.date).toBeNull()
    expect(parsed?.dateRaw).toBe('notadate')
  })

  it('accepts a valid 8-digit YYYYMMDD-shaped date (no calendar validation)', () => {
    expect(parseCampaignName('a-20260230-b')?.date).toBe('20260230')
  })
})

describe('parseCampaignName — agency/bidStrategy/goal lowercasing, no whitelist', () => {
  it('lowercases agency, bidStrategy, and goal but keeps any custom word', () => {
    const parsed = parseCampaignName('InHouse-20260101-MAI-ios-US-Meta-01-Prod-INSTALL-male')
    expect(parsed?.agency).toBe('inhouse')
    expect(parsed?.bidStrategy).toBe('mai')
    expect(parsed?.goal).toBe('install')
  })

  it('accepts any agency/bidStrategy/goal word — no enum validation', () => {
    const parsed = parseCampaignName('totallyMadeUpAgency-20260101-madeUpBidStrategy-ios-US-Meta-01-Prod-madeUpGoal-male')
    expect(parsed?.agency).toBe('totallymadeupagency')
    expect(parsed?.bidStrategy).toBe('madeupbidstrategy')
    expect(parsed?.goal).toBe('madeupgoal')
  })

  it('keeps channelHint, product, audience, and custom verbatim (no lowercasing)', () => {
    const parsed = parseCampaignName('a-20260101-b-ios-US-Google-01-Luddi-install-Female-CustomTag')
    expect(parsed?.channelHint).toBe('Google')
    expect(parsed?.product).toBe('Luddi')
    expect(parsed?.audience).toBe('Female')
    expect(parsed?.custom).toEqual(['CustomTag'])
  })
})

describe('parseCampaignName — malformed input never throws', () => {
  it('empty string → null', () => {
    expect(parseCampaignName('')).toBeNull()
  })

  it('whitespace-only string → null', () => {
    expect(parseCampaignName('   ')).toBeNull()
  })

  it('no dash at all → null', () => {
    expect(parseCampaignName('justonesegment')).toBeNull()
  })

  it('non-string inputs → null', () => {
    expect(parseCampaignName(null)).toBeNull()
    expect(parseCampaignName(undefined)).toBeNull()
    expect(parseCampaignName(123)).toBeNull()
    expect(parseCampaignName({})).toBeNull()
    expect(parseCampaignName(['a', 'b'])).toBeNull()
  })

  it('leading/trailing dashes still parse without throwing', () => {
    expect(() => parseCampaignName('-a-b-')).not.toThrow()
    const parsed = parseCampaignName('-a-b-')
    // leading '-' produces an empty first segment → agency null
    expect(parsed?.agency).toBeNull()
  })

  it('consecutive dashes (empty segment) do not throw and read as null', () => {
    expect(() => parseCampaignName('a--b')).not.toThrow()
    const parsed = parseCampaignName('a--b')
    expect(parsed?.agency).toBe('a')
    expect(parsed?.date).toBeNull()
    expect(parsed?.dateRaw).toBeNull()
  })
})
