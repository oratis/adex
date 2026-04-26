import { describe, it, expect, vi } from 'vitest'

// Tools' validate() is pure and never touches Prisma — but the modules
// import it transitively. Stub it so the import graph stays cheap.
vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))
vi.mock('@/lib/platforms/apply-status', () => ({
  applyCampaignStatusChange: vi.fn(),
}))
vi.mock('@/lib/platforms/registry', () => ({
  getAdapter: vi.fn(),
  isAdaptablePlatform: vi.fn(() => true),
}))
vi.mock('@/lib/platforms/links', () => ({
  upsertPlatformLink: vi.fn(),
  findCampaignLink: vi.fn(),
}))
vi.mock('@/lib/platforms/seedream', () => ({ SeedreamClient: class {} }))
vi.mock('@/lib/platforms/seedance', () => ({ SeedanceClient: class {} }))

import { TOOLS } from './index'

describe('tool catalog', () => {
  it('exports a stable set of names', () => {
    expect(Object.keys(TOOLS).sort()).toEqual([
      'adjust_bid',
      'adjust_daily_budget',
      'adjust_targeting_demo',
      'adjust_targeting_geo',
      'clone_campaign',
      'conclude_experiment',
      'enable_smart_bidding',
      'flag_for_review',
      'generate_creative_variant',
      'noop',
      'pause_ad',
      'pause_ad_group',
      'pause_campaign',
      'push_creative_to_platform',
      'resume_campaign',
      'rotate_creative',
      'start_experiment',
    ])
  })

  it('every tool defines name, description, inputSchema, validate, execute', () => {
    for (const t of Object.values(TOOLS)) {
      expect(typeof t.name).toBe('string')
      expect(t.name.length).toBeGreaterThan(0)
      expect(typeof t.description).toBe('string')
      expect(typeof t.inputSchema).toBe('object')
      expect(typeof t.validate).toBe('function')
      expect(typeof t.execute).toBe('function')
    }
  })

  it('riskLevel is one of the allowed enum values', () => {
    for (const t of Object.values(TOOLS)) {
      expect(['low', 'medium', 'high']).toContain(t.riskLevel)
    }
  })
})

describe('pause_campaign', () => {
  const tool = TOOLS.pause_campaign
  it('accepts a valid campaignId', () => {
    expect(tool.validate({ campaignId: 'c1' })).toEqual({ campaignId: 'c1' })
  })
  it('throws on missing campaignId', () => {
    expect(() => tool.validate({})).toThrow()
  })
  it('inverse maps to resume_campaign', () => {
    expect(tool.inverse?.({ campaignId: 'c1' } as never)).toEqual({
      tool: 'resume_campaign',
      input: { campaignId: 'c1' },
    })
  })
})

describe('resume_campaign', () => {
  const tool = TOOLS.resume_campaign
  it('inverse maps to pause_campaign', () => {
    expect(tool.inverse?.({ campaignId: 'c1' } as never)).toEqual({
      tool: 'pause_campaign',
      input: { campaignId: 'c1' },
    })
  })
})

describe('adjust_daily_budget', () => {
  const tool = TOOLS.adjust_daily_budget
  it('accepts new budget + previous', () => {
    expect(
      tool.validate({ campaignId: 'c1', newDailyBudget: 200, previousDailyBudget: 100 })
    ).toEqual({ campaignId: 'c1', newDailyBudget: 200, previousDailyBudget: 100 })
  })
  it('rejects zero or negative budget', () => {
    expect(() => tool.validate({ campaignId: 'c1', newDailyBudget: 0 })).toThrow()
    expect(() => tool.validate({ campaignId: 'c1', newDailyBudget: -10 })).toThrow()
  })
  it('inverse uses previousDailyBudget if present', () => {
    expect(
      tool.inverse?.({
        campaignId: 'c1',
        newDailyBudget: 200,
        previousDailyBudget: 100,
      } as never)
    ).toEqual({
      tool: 'adjust_daily_budget',
      input: { campaignId: 'c1', newDailyBudget: 100 },
    })
  })
  it('inverse returns null when previous is missing', () => {
    expect(tool.inverse?.({ campaignId: 'c1', newDailyBudget: 200 } as never)).toBeNull()
  })
})

describe('pause_ad_group / pause_ad / rotate_creative', () => {
  it('pause_ad_group requires adGroupId', () => {
    expect(TOOLS.pause_ad_group.validate({ adGroupId: 'ag1' })).toEqual({ adGroupId: 'ag1' })
    expect(() => TOOLS.pause_ad_group.validate({})).toThrow()
  })
  it('pause_ad requires adId', () => {
    expect(TOOLS.pause_ad.validate({ adId: 'a1' })).toEqual({ adId: 'a1' })
    expect(() => TOOLS.pause_ad.validate({})).toThrow()
  })
  it('rotate_creative requires both ids', () => {
    expect(TOOLS.rotate_creative.validate({ adId: 'a1', newCreativeId: 'cr1' })).toEqual({
      adId: 'a1',
      newCreativeId: 'cr1',
    })
    expect(() => TOOLS.rotate_creative.validate({ adId: 'a1' })).toThrow()
  })
})

describe('flag_for_review / noop', () => {
  it('flag_for_review keeps subject + details', () => {
    expect(
      TOOLS.flag_for_review.validate({
        subject: 'Heads up',
        details: 'Something funky',
        campaignId: 'c1',
      })
    ).toEqual({ subject: 'Heads up', details: 'Something funky', campaignId: 'c1' })
  })
  it('flag_for_review rejects empty strings', () => {
    expect(() => TOOLS.flag_for_review.validate({ subject: '', details: 'x' })).toThrow()
  })
  it('noop accepts empty input', () => {
    expect(TOOLS.noop.validate({})).toEqual({})
  })
  it('noop carries reason if present', () => {
    expect(TOOLS.noop.validate({ reason: 'all good' })).toEqual({ reason: 'all good' })
  })
})

describe('clone_campaign', () => {
  it('requires sourceCampaignId, optional newName + dailyBudget', () => {
    expect(
      TOOLS.clone_campaign.validate({
        sourceCampaignId: 'c1',
        newName: 'foo',
        dailyBudget: 50,
      })
    ).toEqual({ sourceCampaignId: 'c1', newName: 'foo', dailyBudget: 50 })
  })
  it('drops bad dailyBudget', () => {
    const r = TOOLS.clone_campaign.validate({ sourceCampaignId: 'c1', dailyBudget: -5 }) as Record<string, unknown>
    expect(r.dailyBudget).toBeUndefined()
  })
})

describe('start_experiment', () => {
  const tool = TOOLS.start_experiment
  const armsOk = [
    { name: 'control', adLinkId: 'al1', trafficShare: 0.5 },
    { name: 'variant', adLinkId: 'al2', trafficShare: 0.5 },
  ]
  it('accepts arms summing to 1.0', () => {
    const r = tool.validate({
      campaignLinkId: 'cl1',
      hypothesis: 'short hypothesis text',
      primaryMetric: 'ctr',
      arms: armsOk,
    }) as Record<string, unknown>
    expect((r.arms as unknown[]).length).toBe(2)
  })
  it('rejects when neither arms nor cloneFromAdGroupLinkId provided', () => {
    expect(() =>
      tool.validate({
        campaignLinkId: 'cl1',
        hypothesis: 'short hypothesis text',
        primaryMetric: 'ctr',
      })
    ).toThrow()
  })
  it('accepts cloneFromAdGroupLinkId without arms', () => {
    const r = tool.validate({
      campaignLinkId: 'cl1',
      hypothesis: 'short hypothesis text',
      primaryMetric: 'ctr',
      cloneFromAdGroupLinkId: 'agl1',
    }) as Record<string, unknown>
    expect(r.cloneFromAdGroupLinkId).toBe('agl1')
  })
  it('rejects bad primaryMetric', () => {
    expect(() =>
      tool.validate({
        campaignLinkId: 'cl1',
        hypothesis: 'short hypothesis text',
        primaryMetric: 'roas',
        arms: armsOk,
      })
    ).toThrow()
  })
  it('rejects arms not summing to 1.0', () => {
    expect(() =>
      tool.validate({
        campaignLinkId: 'cl1',
        hypothesis: 'short hypothesis text',
        primaryMetric: 'ctr',
        arms: [
          { name: 'control', adLinkId: 'al1', trafficShare: 0.6 },
          { name: 'variant', adLinkId: 'al2', trafficShare: 0.6 },
        ],
      })
    ).toThrow()
  })
})

describe('conclude_experiment', () => {
  it('requires experimentId', () => {
    expect(TOOLS.conclude_experiment.validate({ experimentId: 'e1' })).toEqual({
      experimentId: 'e1',
    })
    expect(() => TOOLS.conclude_experiment.validate({})).toThrow()
  })
})

describe('adjust_bid', () => {
  const tool = TOOLS.adjust_bid
  it('accepts valid bid', () => {
    expect(tool.validate({ campaignId: 'c1', newBidUsd: 1.5 })).toEqual({
      campaignId: 'c1',
      newBidUsd: 1.5,
    })
  })
  it('rejects zero / negative', () => {
    expect(() => tool.validate({ campaignId: 'c1', newBidUsd: 0 })).toThrow()
  })
  it('inverse uses previousBidUsd', () => {
    expect(
      tool.inverse?.({ campaignId: 'c1', newBidUsd: 2, previousBidUsd: 1 } as never)
    ).toEqual({
      tool: 'adjust_bid',
      input: { campaignId: 'c1', newBidUsd: 1 },
    })
  })
  it('inverse null when no previous', () => {
    expect(tool.inverse?.({ campaignId: 'c1', newBidUsd: 2 } as never)).toBeNull()
  })
})

describe('enable_smart_bidding', () => {
  const tool = TOOLS.enable_smart_bidding
  it('accepts maximize_conversions without target', () => {
    expect(
      tool.validate({ campaignId: 'c1', strategy: 'maximize_conversions' })
    ).toEqual({ campaignId: 'c1', strategy: 'maximize_conversions' })
  })
  it('requires targetValue for target_cpa', () => {
    expect(() => tool.validate({ campaignId: 'c1', strategy: 'target_cpa' })).toThrow()
    expect(
      tool.validate({ campaignId: 'c1', strategy: 'target_cpa', targetValue: 25 })
    ).toEqual({ campaignId: 'c1', strategy: 'target_cpa', targetValue: 25 })
  })
  it('requires targetValue for target_roas', () => {
    expect(() => tool.validate({ campaignId: 'c1', strategy: 'target_roas' })).toThrow()
  })
  it('rejects unknown strategy', () => {
    expect(() => tool.validate({ campaignId: 'c1', strategy: 'maximize_clicks' })).toThrow()
  })
})

describe('adjust_targeting_geo', () => {
  const tool = TOOLS.adjust_targeting_geo
  it('uppercases country codes', () => {
    const r = tool.validate({
      campaignId: 'c1',
      countriesToAdd: ['us', 'gb'],
    }) as Record<string, unknown>
    expect(r.countriesToAdd).toEqual(['US', 'GB'])
  })
  it('rejects empty changes', () => {
    expect(() => tool.validate({ campaignId: 'c1' })).toThrow()
  })
  it('inverse swaps adds/removes', () => {
    const inv = tool.inverse?.({
      campaignId: 'c1',
      countriesToAdd: ['US'],
      countriesToRemove: ['CA'],
      previousCountries: ['CA', 'GB'],
    } as never)
    expect(inv?.tool).toBe('adjust_targeting_geo')
  })
})

describe('adjust_targeting_demo', () => {
  const tool = TOOLS.adjust_targeting_demo
  it('accepts ageMin/ageMax change', () => {
    const r = tool.validate({ campaignId: 'c1', ageMin: 18, ageMax: 35 }) as Record<string, unknown>
    expect(r.ageMin).toBe(18)
  })
  it('rejects ageMin > ageMax', () => {
    expect(() => tool.validate({ campaignId: 'c1', ageMin: 40, ageMax: 30 })).toThrow()
  })
  it('rejects bad gender enum', () => {
    expect(() => tool.validate({ campaignId: 'c1', gender: 'martian' })).toThrow()
  })
  it('inverse uses previous bag', () => {
    const inv = tool.inverse?.({
      campaignId: 'c1',
      ageMin: 18,
      previous: { ageMin: 25, ageMax: null, gender: 'all' },
    } as never)
    expect(inv?.tool).toBe('adjust_targeting_demo')
  })
})

describe('push_creative_to_platform / generate_creative_variant', () => {
  it('push requires creativeId + platform enum', () => {
    expect(
      TOOLS.push_creative_to_platform.validate({ creativeId: 'cr1', platform: 'meta' })
    ).toEqual({ creativeId: 'cr1', platform: 'meta' })
    expect(() =>
      TOOLS.push_creative_to_platform.validate({ creativeId: 'cr1', platform: 'google' })
    ).toThrow()
  })
  it('generate_creative_variant requires prompt + type enum', () => {
    expect(
      TOOLS.generate_creative_variant.validate({
        prompt: 'a sunny summer ad',
        type: 'image',
      })
    ).toMatchObject({ prompt: 'a sunny summer ad', type: 'image' })
    expect(() =>
      // 4 chars — below the validator's min of 5
      TOOLS.generate_creative_variant.validate({ prompt: 'shrt', type: 'image' })
    ).toThrow()
    expect(() =>
      TOOLS.generate_creative_variant.validate({ prompt: 'long enough', type: 'audio' })
    ).toThrow()
  })
})
