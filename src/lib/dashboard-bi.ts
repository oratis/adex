/**
 * Pure helpers backing the /dashboard BI view (src/app/(dashboard)/dashboard/_client.tsx).
 *
 * Kept dependency-free from React so it's directly unit-testable with vitest.
 * Formatting here intentionally never fabricates a number the API didn't
 * return — callers pass `null`/`undefined` through and get "—" back rather
 * than a derived guess (see AGENTS.md's "don't invent a semantics the backend
 * doesn't own" convention, applied to the funnel-join-pending breakdown cols).
 */

import { cpc as calcCpc, costPerSignup as calcCostPerSignup, costPerPayingUser as calcCostPerPayingUser } from '@/lib/growth/kpi-canon'

// ───────────────────────────── date range ─────────────────────────────

export type QuickRange = '7d' | '14d' | '30d' | 'custom'

const QUICK_RANGE_DAYS: Record<Exclude<QuickRange, 'custom'>, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
}

/** YYYY-MM-DD in UTC — matches how the API parses `start`/`end` with `new Date(str)`. */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Resolve a quick-range preset to concrete start/end dates, inclusive of
 * `today`. `today` defaults to `new Date()` but is a parameter so tests are
 * deterministic.
 */
export function quickRangeDates(range: Exclude<QuickRange, 'custom'>, today: Date = new Date()): { start: string; end: string } {
  const days = QUICK_RANGE_DAYS[range]
  const end = new Date(today)
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  return { start: toISODate(start), end: toISODate(end) }
}

/** Human label for the breakdown table's date column when aggregated into one row. */
export function formatDateRangeLabel(start: string, end: string): string {
  if (!start && !end) return '—'
  if (start === end) return start || end
  return `${start} – ${end}`
}

// ───────────────────────────── formatting ─────────────────────────────

const MONEY_FMT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const INT_FMT = new Intl.NumberFormat('en-US')

/** `$1,234.56`, or "—" for null/undefined/NaN — never coerces missing data to $0. */
export function formatMoneyOrDash(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return MONEY_FMT.format(n)
}

/** Integer count with thousands separators, or "—" for null/undefined. */
export function formatCountOrDash(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return INT_FMT.format(n)
}

/** `n` is a 0..1 ratio → `x.x%`, or "—" for null/undefined. */
export function formatPercentOrDash(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

/** `n` is already an ROI multiple (revenue/spend) → `x.xxx x`, or "—". */
export function formatRoiOrDash(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${n.toFixed(2)}x`
}

// ───────────────────────────── query params ─────────────────────────────

/** Builds a query string from a param bag, dropping null/undefined/empty-string values. */
export function buildQueryString(params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

// ───────────────────────────── field config (drag-orderable optional columns) ─────────────────────────────

export interface FieldToggle {
  key: string
  visible: boolean
}

/**
 * Reconciles a stored (e.g. localStorage) field-config list against the
 * current full set of optional keys a page knows about:
 *  - keeps stored order for keys that still exist
 *  - drops stored keys no longer in `allKeys` (column was removed from the page)
 *  - appends newly-added keys (not in storage) as hidden, in `allKeys` order
 *
 * `stored` may be null (nothing persisted yet) — falls back to all-hidden.
 */
export function mergeFieldConfig(allKeys: string[], stored: FieldToggle[] | null): FieldToggle[] {
  const known = new Set(allKeys)
  const kept = (stored ?? []).filter((f) => known.has(f.key))
  const keptKeys = new Set(kept.map((f) => f.key))
  const added = allKeys.filter((k) => !keptKeys.has(k)).map((key) => ({ key, visible: false }))
  return [...kept, ...added]
}

export function toggleFieldVisibility(fields: FieldToggle[], key: string): FieldToggle[] {
  return fields.map((f) => (f.key === key ? { ...f, visible: !f.visible } : f))
}

/** Moves the item at `fromIndex` to `toIndex`, used by field-config-bar's drag reorder. */
// ───────────────────────────── summary table (os × source) totals ─────────────────────────────

export interface SummaryRow {
  os: string
  source: string
  spend: number | null
  signups: number
  costPerSignup: number | null
  d1Rate: number
  d7Rate: number
  d0Roi: number | null
  d7Roi: number | null
  subscriptionRate: number
  arpu7d: number
  arppu7d: number
  trialToPaidRateApprox: number
  trials: number
  subscribers: number
  costPerPayingUser: number | null
  revenueD0: number
  revenueD7: number
  revenueToDate: number
}

export interface SummaryTotals {
  spend: number | null
  signups: number
  costPerSignup: number | null
  trials: number
  subscribers: number
  costPerPayingUser: number | null
  revenueD0: number
  revenueD7: number
  revenueToDate: number
}

/**
 * Grand-total row for the OS×source summary table. Only sums fields that are
 * true counts (spend, signups, trials, subscribers) and re-derives
 * cost-per-signup/cost-per-paying-user from those sums — the same formula
 * the API itself uses (kpi-canon.costPerSignup/costPerPayingUser).
 *
 * Rate/ROI columns (d1Rate, d7Rate, d0Roi, d7Roi, subscriptionRate, arpu7d,
 * arppu7d, trialToPaidRateApprox) are deliberately NOT aggregated here: the
 * API doesn't return the cohort-size/base denominators needed to weight an
 * average correctly, and a naive mean-of-rates across os×source buckets
 * would misrepresent the true blended rate. Callers should render "—" for
 * those columns in the totals row rather than fabricate a number.
 */
export function summarizeSummaryRows(rows: SummaryRow[]): SummaryTotals {
  let spendSum = 0
  let hasSpend = false
  let signups = 0
  let trials = 0
  let subscribers = 0
  let revenueD0 = 0
  let revenueD7 = 0
  let revenueToDate = 0
  for (const r of rows) {
    if (r.spend !== null) {
      spendSum += r.spend
      hasSpend = true
    }
    signups += r.signups
    trials += r.trials
    subscribers += r.subscribers
    revenueD0 += r.revenueD0
    revenueD7 += r.revenueD7
    revenueToDate += r.revenueToDate
  }
  const spend = hasSpend ? spendSum : null
  return {
    spend,
    signups,
    costPerSignup: spend !== null ? calcCostPerSignup(spend, signups) : null,
    trials,
    subscribers,
    costPerPayingUser: spend !== null ? calcCostPerPayingUser(spend, subscribers) : null,
    revenueD0,
    revenueD7,
    revenueToDate,
  }
}

export function reorderFields(fields: FieldToggle[], fromIndex: number, toIndex: number): FieldToggle[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= fields.length || toIndex >= fields.length) {
    return fields
  }
  const next = [...fields]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export const visibleKeys = (fields: FieldToggle[]): string[] => fields.filter((f) => f.visible).map((f) => f.key)

// ───────────────────────────── breakdown table: client-side filter + aggregation ─────────────────────────────

export interface BreakdownRow {
  date: string
  os: string | null
  platform: string
  agency: string | null
  impressions: number
  clicks: number
  spend: number
  cpc: number | null
  funnelSignups: number | null
  funnelSubscribers: number | null
  funnelJoin: 'pending' | string
}

/** Distinct, non-empty values for `key` across `rows`, sorted ascending. Used to populate dynamic filter options. */
export function collectDistinct<T, K extends keyof T>(rows: T[], key: K): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    const v = r[key]
    if (typeof v === 'string' && v.length > 0) set.add(v)
  }
  return [...set].sort()
}

/** Empty selection means "no filter" (show all) — matches the filter-bar's "全部" state. */
export function filterBreakdownRows(rows: BreakdownRow[], selectedPlatforms: string[], selectedAgencies: string[]): BreakdownRow[] {
  return rows.filter((r) => {
    if (selectedPlatforms.length > 0 && !selectedPlatforms.includes(r.platform)) return false
    if (selectedAgencies.length > 0 && !selectedAgencies.includes(r.agency ?? '')) return false
    return true
  })
}

export interface AggregatedBreakdownRow {
  dateLabel: string
  os: string | null
  platform: string
  agency: string | null
  impressions: number
  clicks: number
  spend: number
  cpc: number | null
  funnelJoin: 'pending'
}

/**
 * Collapses the date dimension: groups by os|platform|agency and sums
 * impressions/clicks/spend, recomputing cpc from the summed totals (never
 * averaging already-derived per-day cpc values). `rangeLabel` is the
 * "区间" string shown in the date column (see formatDateRangeLabel).
 */
export function aggregateBreakdownRows(rows: BreakdownRow[], rangeLabel: string): AggregatedBreakdownRow[] {
  type Agg = { os: string | null; platform: string; agency: string | null; impressions: number; clicks: number; spend: number }
  const groups = new Map<string, Agg>()
  for (const r of rows) {
    const key = `${r.os ?? ''}|${r.platform}|${r.agency ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = { os: r.os, platform: r.platform, agency: r.agency, impressions: 0, clicks: 0, spend: 0 }
      groups.set(key, g)
    }
    g.impressions += r.impressions
    g.clicks += r.clicks
    g.spend += r.spend
  }
  return [...groups.values()]
    .map((g) => ({
      dateLabel: rangeLabel,
      os: g.os,
      platform: g.platform,
      agency: g.agency,
      impressions: g.impressions,
      clicks: g.clicks,
      spend: g.spend,
      cpc: calcCpc(g.spend, g.clicks),
      funnelJoin: 'pending' as const,
    }))
    .sort((x, y) => (x.platform === y.platform ? (x.agency ?? '').localeCompare(y.agency ?? '') : x.platform.localeCompare(y.platform)))
}
