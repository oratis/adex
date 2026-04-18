'use client'

import { useEffect, useState } from 'react'
import { StatCard } from '@/components/layout/stat-card'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TrendChart, type TrendSeries } from '@/components/ui/trend-chart'
import { useT } from '@/components/i18n-provider'
import { formatCurrency, formatNumber, api } from '@/lib/utils'

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

export default function DashboardPage() {
  const { t } = useT()
  const [reports, setReports] = useState<Report[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
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
      setLoading(false)
    }
  }

  const PLATFORM_COLORS: Record<string, string> = {
    google: '#3b82f6',
    meta: '#8b5cf6',
    tiktok: '#111827',
    appsflyer: '#f59e0b',
    adjust: '#10b981',
  }

  function buildTrendSeries(metric: 'spend' | 'clicks' | 'conversions'): TrendSeries[] {
    // Group reports by platform, then by YYYY-MM-DD
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

      // Show sync results
      const platformResults = Object.entries(data.results || {})
        .map(([platform, result]) => {
          if (result.error) return `${platform}: ${result.error}`
          if (result.success) return `${platform}: ${result.impressions || 0} impressions, ${formatCurrency(result.spend || 0)} spend`
          return `${platform}: synced`
        })
        .join(' | ')

      setSyncStatus(platformResults || 'Sync complete')

      // Reload reports from DB
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
          <p className="text-gray-500 text-sm mt-1">{t('page.dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={loadDashboard} variant="outline" size="sm" disabled={loading}>
            {t('action.refresh')}
          </Button>
          <a href={api('/api/reports/export')} download>
            <Button variant="outline" size="sm">⬇ CSV</Button>
          </a>
          <Button onClick={handleSync} disabled={syncing} variant="outline">
            {syncing ? t('action.syncing') : t('action.sync')}
          </Button>
        </div>
      </div>

      {/* Sync status banner */}
      {syncStatus && (
        <div className={`rounded-lg px-4 py-3 text-sm ${syncStatus.includes('failed') || syncStatus.includes('error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
          <div className="flex items-center justify-between">
            <span>{syncStatus}</span>
            <button onClick={() => setSyncStatus(null)} className="text-gray-400 hover:text-gray-600 ml-4">&times;</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-lg border p-6 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
              <div className="h-8 bg-gray-200 rounded w-32" />
            </div>
          ))}
        </div>
      ) : (
        <>
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
                <TrendChart
                  series={buildTrendSeries('spend')}
                  formatY={(n) => formatCurrency(n)}
                />
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
                  { id: 'google',    label: 'Google Ads',     icon: '🔵' },
                  { id: 'meta',      label: 'Meta (Facebook)', icon: '🟣' },
                  { id: 'tiktok',    label: 'TikTok',          icon: '⬛' },
                  { id: 'appsflyer', label: 'AppsFlyer',       icon: '📱' },
                  { id: 'adjust',    label: 'Adjust',          icon: '📐' },
                ].map(({ id, label, icon }) => {
                  const platformReports = reports.filter(r => r.platform === id)
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
        </>
      )}
    </div>
  )
}
