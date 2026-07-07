'use client'

import { useEffect, useMemo, useState } from 'react'
import { StatCard } from '@/components/layout/stat-card'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TrendChart, type TrendSeries } from '@/components/ui/trend-chart'
import { DateRangePicker, type DateRangeValue } from '@/components/ui/date-range-picker'
import { FilterBar, SingleSelect, MultiSelect } from '@/components/ui/filter-bar'
import { FieldConfigBar } from '@/components/ui/field-config-bar'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { useT } from '@/components/i18n-provider'
import { formatCurrency, formatNumber, api } from '@/lib/utils'
import {
  quickRangeDates,
  formatDateRangeLabel,
  formatMoneyOrDash,
  formatCountOrDash,
  formatPercentOrDash,
  formatRoiOrDash,
  buildQueryString,
  collectDistinct,
  filterBreakdownRows,
  aggregateBreakdownRows,
  summarizeSummaryRows,
  type SummaryRow,
  type BreakdownRow,
  type AggregatedBreakdownRow,
} from '@/lib/dashboard-bi'

// ───────────────────────────── legacy widgets (kept, data source unchanged) ─────────────────────────────

interface Report {
  id: string
  platform: string
  date: string
  impressions: number
  clicks: number
  conversions: number
  spend: number
  revenue: number
  installs: number
}

interface Campaign {
  id: string
  name: string
  platform: string
  status: string
  budgets: { amount: number; spent: number }[]
}

interface SyncResult {
  synced: boolean
  results: Record<string, { success?: boolean; error?: string; impressions?: number; clicks?: number; spend?: number }>
  dateRange: { startDate: string; endDate: string }
}

// ───────────────────────────── BI section ─────────────────────────────

const OS_OPTIONS = (t: (k: string) => string) => [
  { value: 'ios', label: t('bi.os.ios') },
  { value: 'android', label: t('bi.os.android') },
  { value: 'web', label: t('bi.os.web') },
]

const SOURCE_OPTIONS = (t: (k: string) => string) => [
  { value: 'paid', label: t('bi.source.paid') },
  { value: 'organic', label: t('bi.source.organic') },
]

export default function DashboardClient() {
  const { t } = useT()

  // ── shared filters ──
  const [range, setRange] = useState<DateRangeValue>(() => ({ ...quickRangeDates('30d'), quickRange: '30d' }))
  const [os, setOs] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [platformFilter, setPlatformFilter] = useState<string[]>([])
  const [agencyFilter, setAgencyFilter] = useState<string[]>([])

  // ── summary table (bi §6 os×source) ──
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([])
  const [summaryHasData, setSummaryHasData] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(false)
  const [summaryOptionalKeys, setSummaryOptionalKeys] = useState<string[]>([])

  // ── breakdown table (bi §6 media delivery detail) ──
  const [breakdownRows, setBreakdownRows] = useState<BreakdownRow[]>([])
  const [breakdownHasData, setBreakdownHasData] = useState(false)
  const [breakdownLoading, setBreakdownLoading] = useState(true)
  const [breakdownError, setBreakdownError] = useState(false)
  const [breakdownMode, setBreakdownMode] = useState<'daily' | 'aggregate'>('daily')

  useEffect(() => {
    setSummaryLoading(true)
    setSummaryError(false)
    const qs = buildQueryString({ start: range.start, end: range.end, os, source })
    fetch(api(`/api/growth/summary${qs}`))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setSummaryRows(Array.isArray(d.rows) ? d.rows : [])
        setSummaryHasData(!!d.hasData)
      })
      .catch(() => setSummaryError(true))
      .finally(() => setSummaryLoading(false))
  }, [range.start, range.end, os, source])

  useEffect(() => {
    setBreakdownLoading(true)
    setBreakdownError(false)
    // platform/agency are NOT sent to the API — the full range's rows are
    // fetched once so the filter dropdowns can dynamically collect every
    // platform/agency value actually present, then filtering happens
    // client-side (see filterBreakdownRows below).
    const qs = buildQueryString({ start: range.start, end: range.end, os })
    fetch(api(`/api/reports/breakdown${qs}`))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setBreakdownRows(Array.isArray(d.rows) ? d.rows : [])
        setBreakdownHasData(!!d.hasData)
      })
      .catch(() => setBreakdownError(true))
      .finally(() => setBreakdownLoading(false))
  }, [range.start, range.end, os])

  const platformOptions = useMemo(
    () => collectDistinct(breakdownRows, 'platform').map((v) => ({ value: v, label: v })),
    [breakdownRows]
  )
  const agencyOptions = useMemo(
    () => collectDistinct(breakdownRows, 'agency').map((v) => ({ value: v, label: v })),
    [breakdownRows]
  )

  const filteredBreakdownRows = useMemo(
    () => filterBreakdownRows(breakdownRows, platformFilter, agencyFilter),
    [breakdownRows, platformFilter, agencyFilter]
  )

  const rangeLabel = formatDateRangeLabel(range.start, range.end)
  const aggregatedBreakdownRows = useMemo(
    () => aggregateBreakdownRows(filteredBreakdownRows, rangeLabel),
    [filteredBreakdownRows, rangeLabel]
  )

  const summaryTotals = useMemo(() => summarizeSummaryRows(summaryRows), [summaryRows])

  // ── summary table columns ──
  const summaryBaseColumns: DataTableColumn<SummaryRow>[] = [
    { key: 'os', label: t('bi.col.os'), format: (r) => r.os },
    { key: 'source', label: t('bi.col.source'), format: (r) => r.source },
    { key: 'spend', label: t('bi.col.spend'), align: 'right', format: (r) => formatMoneyOrDash(r.spend) },
    { key: 'signups', label: t('bi.col.signups'), align: 'right', format: (r) => formatCountOrDash(r.signups) },
    { key: 'costPerSignup', label: t('bi.col.cost_per_signup'), align: 'right', format: (r) => formatMoneyOrDash(r.costPerSignup) },
    { key: 'd1Rate', label: t('bi.col.d1_rate'), align: 'right', format: (r) => formatPercentOrDash(r.d1Rate) },
    { key: 'd7Rate', label: t('bi.col.d7_rate'), align: 'right', format: (r) => formatPercentOrDash(r.d7Rate) },
    { key: 'd0Roi', label: t('bi.col.d0_roi'), align: 'right', format: (r) => formatRoiOrDash(r.d0Roi) },
    { key: 'd7Roi', label: t('bi.col.d7_roi'), align: 'right', format: (r) => formatRoiOrDash(r.d7Roi) },
    { key: 'revenueToDate', label: t('bi.col.revenue_to_date'), title: t('bi.col.revenue_to_date_title'), align: 'right', format: (r) => formatMoneyOrDash(r.revenueToDate) },
  ]

  const summaryOptionalColumnDefs: Record<string, DataTableColumn<SummaryRow>> = {
    subscriptionRate: { key: 'subscriptionRate', label: t('bi.col.subscription_rate'), align: 'right', format: (r) => formatPercentOrDash(r.subscriptionRate) },
    arpu7d: { key: 'arpu7d', label: t('bi.col.arpu7d'), align: 'right', format: (r) => formatMoneyOrDash(r.arpu7d) },
    arppu7d: { key: 'arppu7d', label: t('bi.col.arppu7d'), align: 'right', format: (r) => formatMoneyOrDash(r.arppu7d) },
    trialToPaidRateApprox: { key: 'trialToPaidRateApprox', label: t('bi.col.trial_to_paid_rate'), align: 'right', format: (r) => formatPercentOrDash(r.trialToPaidRateApprox) },
    trials: { key: 'trials', label: t('bi.col.trials'), align: 'right', format: (r) => formatCountOrDash(r.trials) },
    subscribers: { key: 'subscribers', label: t('bi.col.subscribers'), align: 'right', format: (r) => formatCountOrDash(r.subscribers) },
    costPerPayingUser: { key: 'costPerPayingUser', label: t('bi.col.cost_per_paying_user'), align: 'right', format: (r) => formatMoneyOrDash(r.costPerPayingUser) },
    revenueD0: { key: 'revenueD0', label: t('bi.col.revenue_d0'), align: 'right', format: (r) => formatMoneyOrDash(r.revenueD0) },
    revenueD7: { key: 'revenueD7', label: t('bi.col.revenue_d7'), align: 'right', format: (r) => formatMoneyOrDash(r.revenueD7) },
  }
  const summaryOptionalFieldOptions = Object.values(summaryOptionalColumnDefs).map((c) => ({ key: c.key, label: c.label }))

  const summaryColumns: DataTableColumn<SummaryRow>[] = [
    ...summaryBaseColumns,
    ...summaryOptionalKeys.map((k) => summaryOptionalColumnDefs[k]).filter(Boolean),
  ]

  // totals row: only counts + derived cost-per-* are safe to aggregate across
  // os×source buckets (see summarizeSummaryRows doc comment) — rate/ROI
  // columns render "—" rather than a fabricated average.
  const summaryTotalsRow: SummaryRow = {
    os: '',
    source: '',
    spend: summaryTotals.spend,
    signups: summaryTotals.signups,
    costPerSignup: summaryTotals.costPerSignup,
    d1Rate: NaN,
    d7Rate: NaN,
    d0Roi: null,
    d7Roi: null,
    subscriptionRate: NaN,
    arpu7d: NaN,
    arppu7d: NaN,
    trialToPaidRateApprox: NaN,
    trials: summaryTotals.trials,
    subscribers: summaryTotals.subscribers,
    costPerPayingUser: summaryTotals.costPerPayingUser,
    revenueD0: summaryTotals.revenueD0,
    revenueD7: summaryTotals.revenueD7,
    revenueToDate: summaryTotals.revenueToDate,
  }

  // ── breakdown table columns ──
  const pendingTitle = t('bi.col.pending_title')
  const breakdownColumns: DataTableColumn<AggregatedBreakdownRow & { date?: string }>[] = [
    {
      key: 'date',
      label: breakdownMode === 'aggregate' ? t('bi.col.date_range') : t('bi.col.date'),
      format: (r) => (breakdownMode === 'aggregate' ? r.dateLabel : r.date ?? r.dateLabel),
    },
    { key: 'os', label: t('bi.col.os'), format: (r) => r.os ?? '—' },
    { key: 'platform', label: t('bi.col.platform'), format: (r) => r.platform },
    { key: 'agency', label: t('bi.col.agency'), format: (r) => r.agency ?? '—' },
    { key: 'impressions', label: t('bi.col.impressions'), align: 'right', format: (r) => formatCountOrDash(r.impressions) },
    { key: 'clicks', label: t('bi.col.clicks'), align: 'right', format: (r) => formatCountOrDash(r.clicks) },
    { key: 'spend', label: t('bi.col.spend'), align: 'right', format: (r) => formatMoneyOrDash(r.spend) },
    { key: 'cpc', label: t('bi.col.cpc'), align: 'right', format: (r) => formatMoneyOrDash(r.cpc) },
    { key: 'signups', label: t('bi.col.signups'), align: 'right', title: pendingTitle, format: () => '—' },
    { key: 'costPerSignup', label: t('bi.col.cost_per_signup'), align: 'right', title: pendingTitle, format: () => '—' },
    { key: 'd1Rate', label: t('bi.col.d1_rate'), align: 'right', title: pendingTitle, format: () => '—' },
    { key: 'd7Rate', label: t('bi.col.d7_rate'), align: 'right', title: pendingTitle, format: () => '—' },
    { key: 'd0Roi', label: t('bi.col.d0_roi'), align: 'right', title: pendingTitle, format: () => '—' },
    { key: 'd7Roi', label: t('bi.col.d7_roi'), align: 'right', title: pendingTitle, format: () => '—' },
  ]

  const breakdownDisplayRows: (AggregatedBreakdownRow & { date?: string })[] =
    breakdownMode === 'aggregate'
      ? aggregatedBreakdownRows
      : filteredBreakdownRows.map((r) => ({
          date: r.date,
          dateLabel: r.date,
          os: r.os,
          platform: r.platform,
          agency: r.agency,
          impressions: r.impressions,
          clicks: r.clicks,
          spend: r.spend,
          cpc: r.cpc,
          funnelJoin: 'pending' as const,
        }))

  // ── legacy widgets state (unchanged data source: /api/reports, /api/campaigns) ──
  const [reports, setReports] = useState<Report[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [legacyLoading, setLegacyLoading] = useState(true)

  useEffect(() => {
    loadLegacy()
  }, [])

  async function loadLegacy() {
    setLegacyLoading(true)
    try {
      const [reportsRes, campaignsRes] = await Promise.all([
        fetch(api('/api/reports')).catch(() => null),
        fetch(api('/api/campaigns')).catch(() => null),
      ])
      if (reportsRes?.ok) {
        const data = await reportsRes.json()
        setReports(Array.isArray(data) ? data : [])
      }
      if (campaignsRes?.ok) {
        const data = await campaignsRes.json()
        setCampaigns(Array.isArray(data) ? data : [])
      }
    } catch {
      // Silently fail - show empty state
    } finally {
      setLegacyLoading(false)
    }
  }

  const PLATFORM_COLORS: Record<string, string> = {
    google: '#3b82f6',
    meta: '#8b5cf6',
    tiktok: '#111827',
    amazon: '#ea580c',
    linkedin: '#0a66c2',
    appsflyer: '#f59e0b',
    adjust: '#10b981',
  }

  function buildTrendSeries(metric: 'spend' | 'clicks' | 'conversions'): TrendSeries[] {
    const byPlatform: Record<string, Record<string, number>> = {}
    for (const r of reports) {
      const day = r.date.split('T')[0]
      if (!byPlatform[r.platform]) byPlatform[r.platform] = {}
      byPlatform[r.platform][day] = (byPlatform[r.platform][day] || 0) + (r[metric] || 0)
    }
    return Object.entries(byPlatform).map(([platform, byDay]) => ({
      name: platform.charAt(0).toUpperCase() + platform.slice(1),
      color: PLATFORM_COLORS[platform] || '#6b7280',
      points: Object.entries(byDay)
        .map(([x, y]) => ({ x, y }))
        .sort((a, b) => a.x.localeCompare(b.x)),
    }))
  }

  const totalSpend = reports.reduce((s, r) => s + (r.spend || 0), 0)
  const totalRevenue = reports.reduce((s, r) => s + (r.revenue || 0), 0)
  const totalImpressions = reports.reduce((s, r) => s + (r.impressions || 0), 0)
  const totalClicks = reports.reduce((s, r) => s + (r.clicks || 0), 0)
  const totalConversions = reports.reduce((s, r) => s + (r.conversions || 0), 0)
  const totalInstalls = reports.reduce((s, r) => s + (r.installs || 0), 0)
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
  const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0

  async function handleSync() {
    setSyncing(true)
    setSyncStatus('Syncing platform data...')
    try {
      const res = await fetch(api('/api/reports/sync'), { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Sync failed' }))
        setSyncStatus(`Sync failed: ${err.error || 'Unknown error'}`)
        return
      }
      const data: SyncResult = await res.json()
      const platformResults = Object.entries(data.results || {})
        .map(([platform, result]) => {
          if (result.error) return `${platform}: ${result.error}`
          if (result.success) return `${platform}: ${result.impressions || 0} impressions, ${formatCurrency(result.spend || 0)} spend`
          return `${platform}: synced`
        })
        .join(' | ')
      setSyncStatus(platformResults || 'Sync complete')
      const reportsRes = await fetch(api('/api/reports'))
      if (reportsRes.ok) {
        const reportsData = await reportsRes.json()
        setReports(Array.isArray(reportsData) ? reportsData : [])
      }
    } catch (err) {
      setSyncStatus(`Sync error: ${err instanceof Error ? err.message : 'Network error'}`)
    } finally {
      setSyncing(false)
    }
  }

  const statusVariant = (s: string) => {
    switch (s) {
      case 'active': return 'success' as const
      case 'paused': return 'warning' as const
      case 'completed': return 'info' as const
      default: return 'default' as const
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('page.dashboard.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('bi.dashboard.subtitle')}</p>
        </div>
      </div>

      {/* ── shared date range + filters ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <FilterBar>
          <SingleSelect label={t('bi.filter.os')} options={OS_OPTIONS(t)} value={os} onChange={setOs} />
          <SingleSelect label={t('bi.filter.source')} options={SOURCE_OPTIONS(t)} value={source} onChange={setSource} />
          <MultiSelect label={t('bi.filter.platform')} options={platformOptions} selected={platformFilter} onChange={setPlatformFilter} />
          <MultiSelect label={t('bi.filter.agency')} options={agencyOptions} selected={agencyFilter} onChange={setAgencyFilter} />
        </FilterBar>
      </div>

      {/* ── table 1: OS × source summary ── */}
      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle>{t('bi.table.os_summary.title')}</CardTitle>
          <FieldConfigBar
            storageKey="adex.dashboard.summary.columns"
            baseFields={summaryBaseColumns.map((c) => ({ key: c.key, label: c.label }))}
            optionalFields={summaryOptionalFieldOptions}
            onChange={setSummaryOptionalKeys}
          />
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>
          ) : summaryError ? (
            <div className="rounded-lg px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">
              Couldn&apos;t load summary data. Try again shortly.
            </div>
          ) : (
            <DataTable
              columns={summaryColumns}
              rows={summaryRows}
              getRowKey={(r) => `${r.os}|${r.source}`}
              totals={summaryHasData ? summaryTotalsRow : undefined}
              totalsLabel={t('bi.table.totals')}
              emptyTitle={t('bi.empty.summary')}
            />
          )}
        </CardContent>
      </Card>

      {/* ── table 2: media delivery detail ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('bi.table.breakdown.title')}</CardTitle>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            {t('bi.table.mode.label')}:
            <select
              value={breakdownMode}
              onChange={(e) => setBreakdownMode(e.target.value as 'daily' | 'aggregate')}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="daily">{t('bi.table.mode.daily')}</option>
              <option value="aggregate">{t('bi.table.mode.aggregate')}</option>
            </select>
          </label>
        </CardHeader>
        <CardContent>
          {breakdownLoading ? (
            <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>
          ) : breakdownError ? (
            <div className="rounded-lg px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">
              Couldn&apos;t load delivery data. Try again shortly.
            </div>
          ) : (
            <DataTable
              columns={breakdownColumns}
              rows={breakdownDisplayRows}
              getRowKey={(r, i) => `${r.date ?? r.dateLabel}|${r.os}|${r.platform}|${r.agency}|${i}`}
              emptyTitle={t('bi.empty.breakdown')}
            />
          )}
          {!breakdownHasData && !breakdownLoading && !breakdownError && (
            <p className="text-xs text-gray-400 mt-2">{pendingTitle}</p>
          )}
        </CardContent>
      </Card>

      {/* ── legacy overview (kept below, unchanged data source) ── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-400 mb-3">{t('bi.legacy.title')}</h2>

        {syncStatus && (
          <div className={`rounded-lg px-4 py-3 text-sm mb-4 ${syncStatus.includes('failed') || syncStatus.includes('error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
            <div className="flex items-center justify-between">
              <span>{syncStatus}</span>
              <button onClick={() => setSyncStatus(null)} className="text-gray-400 hover:text-gray-600 ml-4">&times;</button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <Button onClick={loadLegacy} variant="outline" size="sm" disabled={legacyLoading}>
            {t('action.refresh')}
          </Button>
          <a href={api('/api/reports/export')} download>
            <Button variant="outline" size="sm">⬇ CSV</Button>
          </a>
          <Button onClick={handleSync} disabled={syncing} variant="outline">
            {syncing ? t('action.syncing') : t('action.sync')}
          </Button>
        </div>

        {legacyLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-lg border p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
                <div className="h-8 bg-gray-200 rounded w-32" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title={t('stats.total_spend')} value={formatCurrency(totalSpend)} icon={<span>💰</span>} />
              <StatCard title={t('stats.revenue')} value={formatCurrency(totalRevenue)} changeType={roas > 1 ? 'positive' : 'negative'} change={`ROAS: ${roas.toFixed(2)}x`} icon={<span>📈</span>} />
              <StatCard title={t('stats.impressions')} value={formatNumber(totalImpressions)} change={`CTR: ${ctr.toFixed(2)}%`} icon={<span>👁️</span>} />
              <StatCard title={t('stats.conversions')} value={formatNumber(totalConversions)} change={`Installs: ${formatNumber(totalInstalls)}`} icon={<span>🎯</span>} />
            </div>

            {reports.length === 0 && campaigns.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-4xl mb-3">📊</p>
                  <p className="font-medium text-gray-700">No data yet</p>
                  <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                    Connect your ad platforms in Settings, then click &quot;Sync Data&quot; to pull performance metrics.
                  </p>
                </CardContent>
              </Card>
            )}

            {reports.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Spend by Platform (last 7 days)</CardTitle>
                </CardHeader>
                <CardContent>
                  <TrendChart series={buildTrendSeries('spend')} formatY={(n) => formatCurrency(n)} />
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Active Campaigns</CardTitle>
                </CardHeader>
                <CardContent>
                  {campaigns.length === 0 ? (
                    <p className="text-gray-500 text-sm py-4">No campaigns yet. Create your first campaign to get started.</p>
                  ) : (
                    <div className="space-y-3">
                      {campaigns.slice(0, 5).map((c) => (
                        <div key={c.id} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div>
                            <p className="font-medium text-sm">{c.name}</p>
                            <p className="text-xs text-gray-500 capitalize">{c.platform}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            {c.budgets?.[0] && (
                              <span className="text-sm text-gray-600">
                                {formatCurrency(c.budgets[0].spent)} / {formatCurrency(c.budgets[0].amount)}
                              </span>
                            )}
                            <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Platform Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  {[
                    { id: 'google', label: 'Google Ads', icon: '🔵' },
                    { id: 'meta', label: 'Meta (Facebook)', icon: '🟣' },
                    { id: 'tiktok', label: 'TikTok', icon: '⬛' },
                    { id: 'amazon', label: 'Amazon Ads', icon: '🟠' },
                    { id: 'linkedin', label: 'LinkedIn Ads', icon: '🔷' },
                    { id: 'appsflyer', label: 'AppsFlyer', icon: '📱' },
                    { id: 'adjust', label: 'Adjust', icon: '📐' },
                  ].map(({ id, label, icon }) => {
                    const platformReports = reports.filter((r) => r.platform === id)
                    if (platformReports.length === 0) return null
                    const spend = platformReports.reduce((s, r) => s + (r.spend || 0), 0)
                    const clicks = platformReports.reduce((s, r) => s + (r.clicks || 0), 0)
                    const conversions = platformReports.reduce((s, r) => s + (r.conversions || 0), 0)
                    return (
                      <div key={id} className="flex items-center justify-between py-3 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{icon}</span>
                          <span className="font-medium text-sm">{label}</span>
                        </div>
                        <div className="text-right text-sm">
                          <p>{formatCurrency(spend)} spent</p>
                          <p className="text-gray-500 text-xs">{formatNumber(clicks)} clicks &middot; {formatNumber(conversions)} conv.</p>
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
