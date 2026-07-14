import { describe, expect, it } from 'vitest'
import {
  quickRangeDates,
  formatDateRangeLabel,
  formatMoneyOrDash,
  formatCountOrDash,
  formatPercentOrDash,
  formatRoiOrDash,
  buildQueryString,
  mergeFieldConfig,
  toggleFieldVisibility,
  reorderFields,
  visibleKeys,
  collectDistinct,
  filterBreakdownRows,
  aggregateBreakdownRows,
  summarizeSummaryRows,
  type BreakdownRow,
  type FieldToggle,
  type SummaryRow,
} from './dashboard-bi'

describe('quickRangeDates', () => {
  const today = new Date('2026-07-07T12:00:00Z')

  it('7d is inclusive of today, spanning 7 calendar days', () => {
    expect(quickRangeDates('7d', today)).toEqual({ start: '2026-07-01', end: '2026-07-07' })
  })

  it('14d', () => {
    expect(quickRangeDates('14d', today)).toEqual({ start: '2026-06-24', end: '2026-07-07' })
  })

  it('30d', () => {
    expect(quickRangeDates('30d', today)).toEqual({ start: '2026-06-08', end: '2026-07-07' })
  })
})

describe('formatDateRangeLabel', () => {
  it('collapses equal start/end to a single date', () => {
    expect(formatDateRangeLabel('2026-07-01', '2026-07-01')).toBe('2026-07-01')
  })
  it('renders a range with an en dash', () => {
    expect(formatDateRangeLabel('2026-07-01', '2026-07-07')).toBe('2026-07-01 – 2026-07-07')
  })
  it('handles empty input', () => {
    expect(formatDateRangeLabel('', '')).toBe('—')
  })
})

describe('formatters never fabricate missing data', () => {
  it('formatMoneyOrDash', () => {
    expect(formatMoneyOrDash(1234.5)).toBe('$1,234.50')
    expect(formatMoneyOrDash(null)).toBe('—')
    expect(formatMoneyOrDash(undefined)).toBe('—')
    expect(formatMoneyOrDash(NaN)).toBe('—')
  })
  it('formatCountOrDash', () => {
    expect(formatCountOrDash(12345)).toBe('12,345')
    expect(formatCountOrDash(null)).toBe('—')
  })
  it('formatPercentOrDash treats input as a 0..1 ratio', () => {
    expect(formatPercentOrDash(0.1234)).toBe('12.3%')
    expect(formatPercentOrDash(null)).toBe('—')
  })
  it('formatRoiOrDash', () => {
    expect(formatRoiOrDash(1.5)).toBe('1.50x')
    expect(formatRoiOrDash(null)).toBe('—')
  })
})

describe('buildQueryString', () => {
  it('drops null/undefined/empty values', () => {
    expect(buildQueryString({ a: '1', b: null, c: undefined, d: '' })).toBe('?a=1')
  })
  it('returns empty string when nothing set', () => {
    expect(buildQueryString({ a: null })).toBe('')
  })
})

describe('mergeFieldConfig', () => {
  it('falls back to all-hidden when nothing stored', () => {
    expect(mergeFieldConfig(['a', 'b'], null)).toEqual([
      { key: 'a', visible: false },
      { key: 'b', visible: false },
    ])
  })
  it('keeps stored order and visibility for known keys', () => {
    const stored: FieldToggle[] = [{ key: 'b', visible: true }, { key: 'a', visible: false }]
    expect(mergeFieldConfig(['a', 'b'], stored)).toEqual(stored)
  })
  it('drops stored keys no longer known, appends new keys as hidden', () => {
    const stored: FieldToggle[] = [{ key: 'gone', visible: true }, { key: 'a', visible: true }]
    expect(mergeFieldConfig(['a', 'b'], stored)).toEqual([
      { key: 'a', visible: true },
      { key: 'b', visible: false },
    ])
  })
})

describe('toggleFieldVisibility', () => {
  it('flips only the matching key', () => {
    const fields: FieldToggle[] = [{ key: 'a', visible: false }, { key: 'b', visible: true }]
    expect(toggleFieldVisibility(fields, 'a')).toEqual([
      { key: 'a', visible: true },
      { key: 'b', visible: true },
    ])
  })
})

describe('reorderFields', () => {
  const fields: FieldToggle[] = [{ key: 'a', visible: true }, { key: 'b', visible: true }, { key: 'c', visible: true }]

  it('moves an item forward', () => {
    expect(reorderFields(fields, 0, 2).map((f) => f.key)).toEqual(['b', 'c', 'a'])
  })
  it('moves an item backward', () => {
    expect(reorderFields(fields, 2, 0).map((f) => f.key)).toEqual(['c', 'a', 'b'])
  })
  it('no-ops on out-of-range indices', () => {
    expect(reorderFields(fields, 0, 5)).toBe(fields)
    expect(reorderFields(fields, -1, 1)).toBe(fields)
  })
})

describe('visibleKeys', () => {
  it('filters to visible, in order', () => {
    const fields: FieldToggle[] = [{ key: 'a', visible: false }, { key: 'b', visible: true }, { key: 'c', visible: true }]
    expect(visibleKeys(fields)).toEqual(['b', 'c'])
  })
})

const row = (over: Partial<BreakdownRow> = {}): BreakdownRow => ({
  date: '2026-07-01',
  os: 'ios',
  platform: 'meta',
  agency: 'acme',
  impressions: 1000,
  clicks: 100,
  spend: 50,
  cpc: 0.5,
  signups: null,
  costPerSignup: null,
  d1Rate: null,
  d7Rate: null,
  d0Roi: null,
  d7Roi: null,
  ...over,
})

describe('collectDistinct', () => {
  it('collects sorted unique non-empty string values', () => {
    const rows = [row({ platform: 'meta' }), row({ platform: 'tiktok' }), row({ platform: 'meta' })]
    expect(collectDistinct(rows, 'platform')).toEqual(['meta', 'tiktok'])
  })
  it('excludes null', () => {
    const rows = [row({ agency: null }), row({ agency: 'acme' })]
    expect(collectDistinct(rows, 'agency')).toEqual(['acme'])
  })
})

describe('filterBreakdownRows', () => {
  const rows = [
    row({ platform: 'meta', agency: 'acme' }),
    row({ platform: 'tiktok', agency: 'acme' }),
    row({ platform: 'meta', agency: 'other' }),
  ]

  it('empty selections mean no filter', () => {
    expect(filterBreakdownRows(rows, [], [])).toHaveLength(3)
  })
  it('filters by platform', () => {
    expect(filterBreakdownRows(rows, ['tiktok'], [])).toHaveLength(1)
  })
  it('filters by agency', () => {
    expect(filterBreakdownRows(rows, [], ['other'])).toHaveLength(1)
  })
  it('combines both filters (AND)', () => {
    expect(filterBreakdownRows(rows, ['meta'], ['other'])).toHaveLength(1)
  })
})

describe('aggregateBreakdownRows', () => {
  it('sums metrics across dates within the same os|platform|agency group and recomputes cpc from totals', () => {
    const rows = [
      row({ date: '2026-07-01', platform: 'meta', agency: 'acme', impressions: 1000, clicks: 100, spend: 50 }),
      row({ date: '2026-07-02', platform: 'meta', agency: 'acme', impressions: 2000, clicks: 300, spend: 60 }),
    ]
    const agg = aggregateBreakdownRows(rows, '2026-07-01 – 2026-07-02')
    expect(agg).toHaveLength(1)
    expect(agg[0]).toMatchObject({
      dateLabel: '2026-07-01 – 2026-07-02',
      platform: 'meta',
      agency: 'acme',
      impressions: 3000,
      clicks: 400,
      spend: 110,
    })
    expect(agg[0].cpc).toBeCloseTo(110 / 400)
  })

  it('keeps distinct os|platform|agency groups separate', () => {
    const rows = [row({ platform: 'meta' }), row({ platform: 'tiktok' })]
    expect(aggregateBreakdownRows(rows, 'x')).toHaveLength(2)
  })

  it('cpc is null when clicks sum to 0', () => {
    const rows = [row({ clicks: 0, spend: 10 })]
    expect(aggregateBreakdownRows(rows, 'x')[0].cpc).toBeNull()
  })

  it('sums signups across joined rows and recomputes costPerSignup from the sums', () => {
    const rows = [
      row({ date: '2026-07-01', spend: 50, signups: 10, costPerSignup: 5 }),
      row({ date: '2026-07-02', spend: 60, signups: 20, costPerSignup: 3 }),
    ]
    const agg = aggregateBreakdownRows(rows, 'x')
    expect(agg[0].signups).toBe(30)
    expect(agg[0].costPerSignup).toBeCloseTo(110 / 30)
  })

  it('signups/costPerSignup stay null when no row in the group joined', () => {
    const rows = [row({ signups: null, costPerSignup: null })]
    expect(aggregateBreakdownRows(rows, 'x')[0].signups).toBeNull()
    expect(aggregateBreakdownRows(rows, 'x')[0].costPerSignup).toBeNull()
  })

  it('mixed joined/unjoined group: costPerSignup uses joined-days spend only', () => {
    // Day 1 joined ($50 spend, 10 signups); day 2 did NOT join ($60 spend,
    // signups unknown). Total spend still reports $110, but costPerSignup
    // must be 50/10 — dividing all-days spend by joined-only signups would
    // inflate it to 11 (the funnelJoin:'partial' silent-failure bug).
    const rows = [
      row({ date: '2026-07-01', spend: 50, signups: 10, costPerSignup: 5 }),
      row({ date: '2026-07-02', spend: 60, signups: null, costPerSignup: null }),
    ]
    const agg = aggregateBreakdownRows(rows, 'x')[0]
    expect(agg.spend).toBe(110)
    expect(agg.signups).toBe(10)
    expect(agg.costPerSignup).toBeCloseTo(5)
  })

  it('d1Rate/d7Rate/d0Roi/d7Roi are always null in aggregate mode (not re-derivable across dates)', () => {
    const rows = [row({ d1Rate: 0.3, d7Rate: 0.2, d0Roi: 1.1, d7Roi: 1.4 })]
    const agg = aggregateBreakdownRows(rows, 'x')[0]
    expect(agg.d1Rate).toBeNull()
    expect(agg.d7Rate).toBeNull()
    expect(agg.d0Roi).toBeNull()
    expect(agg.d7Roi).toBeNull()
  })
})

const summaryRow = (over: Partial<SummaryRow> = {}): SummaryRow => ({
  os: 'ios',
  source: 'paid',
  spend: 100,
  signups: 10,
  costPerSignup: 10,
  d1Rate: 0.5,
  d7Rate: 0.3,
  d0Roi: 1.2,
  d7Roi: 1.5,
  subscriptionRate: 0.1,
  arpu7d: 2,
  arppu7d: 20,
  trialToPaidRateApprox: 0.2,
  trials: 5,
  subscribers: 2,
  costPerPayingUser: 50,
  revenueD0: 3,
  revenueD7: 8,
  revenueToDate: 15,
  ...over,
})

describe('summarizeSummaryRows', () => {
  it('sums counts and re-derives cost-per-* from the sums', () => {
    const rows = [
      summaryRow({ spend: 100, signups: 10, trials: 5, subscribers: 2 }),
      summaryRow({ spend: 200, signups: 20, trials: 10, subscribers: 8 }),
    ]
    const totals = summarizeSummaryRows(rows)
    expect(totals.spend).toBe(300)
    expect(totals.signups).toBe(30)
    expect(totals.trials).toBe(15)
    expect(totals.subscribers).toBe(10)
    expect(totals.costPerSignup).toBeCloseTo(10)
    expect(totals.costPerPayingUser).toBeCloseTo(30)
  })

  it('sums the revenue window columns as plain totals', () => {
    const rows = [
      summaryRow({ revenueD0: 3, revenueD7: 8, revenueToDate: 15 }),
      summaryRow({ revenueD0: 7, revenueD7: 12, revenueToDate: 25 }),
    ]
    const totals = summarizeSummaryRows(rows)
    expect(totals.revenueD0).toBe(10)
    expect(totals.revenueD7).toBe(20)
    expect(totals.revenueToDate).toBe(40)
  })

  it('spend is null when every row lacks spend data (never coerces to 0)', () => {
    const rows = [summaryRow({ spend: null }), summaryRow({ spend: null })]
    const totals = summarizeSummaryRows(rows)
    expect(totals.spend).toBeNull()
    expect(totals.costPerSignup).toBeNull()
    expect(totals.costPerPayingUser).toBeNull()
  })

  it('sums spend across rows even when some rows lack it', () => {
    const rows = [summaryRow({ spend: 100 }), summaryRow({ spend: null })]
    expect(summarizeSummaryRows(rows).spend).toBe(100)
  })
})
