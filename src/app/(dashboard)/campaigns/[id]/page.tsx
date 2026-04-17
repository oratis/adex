'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { formatCurrency, formatNumber, api } from '@/lib/utils'

interface CampaignDetail {
  id: string
  name: string
  platform: string
  status: string
  objective: string | null
  targetCountries: string | null
  ageMin: number | null
  ageMax: number | null
  gender: string | null
  startDate: string | null
  endDate: string | null
  createdAt: string
  platformCampaignId: string | null
  budgets: Array<{
    id: string
    type: string
    amount: number
    currency: string
    spent: number
  }>
  adGroups: Array<{
    id: string
    name: string
    status: string
    ads: Array<{
      id: string
      name: string
      headline: string | null
      description: string | null
      status: string
      creative: { id: string; name: string; type: string; fileUrl: string | null } | null
    }>
  }>
  reports: Array<{
    id: string
    date: string
    impressions: number
    clicks: number
    conversions: number
    spend: number
    revenue: number
    ctr: number
    roas: number
  }>
}

export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const { toast } = useToast()
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(api(`/api/campaigns/${id}`))
      if (!res.ok) {
        if (res.status === 404) setError('Campaign not found')
        else setError((await res.json()).error || 'Failed to load')
        return
      }
      setCampaign(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function toggleStatus() {
    if (!campaign) return
    const next = campaign.status === 'active' ? 'paused' : 'active'
    try {
      const res = await fetch(api(`/api/campaigns/${id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) throw new Error()
      toast({ variant: 'success', title: `Campaign ${next}` })
      load()
    } catch {
      toast({ variant: 'error', title: 'Status update failed' })
    }
  }

  const statusVariant = (s: string) => {
    switch (s) {
      case 'active':    return 'success' as const
      case 'paused':    return 'warning' as const
      case 'completed': return 'info' as const
      default:          return 'default' as const
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading campaign…</div>
  }

  if (error || !campaign) {
    return (
      <div className="space-y-4">
        <Link href="/campaigns" className="text-sm text-blue-600 hover:underline">← Back to Campaigns</Link>
        <Card><CardContent className="py-12 text-center">
          <p className="text-red-600">{error || 'Campaign not found'}</p>
        </CardContent></Card>
      </div>
    )
  }

  const totalSpend  = campaign.reports.reduce((s, r) => s + (r.spend || 0), 0)
  const totalRev    = campaign.reports.reduce((s, r) => s + (r.revenue || 0), 0)
  const totalImp    = campaign.reports.reduce((s, r) => s + (r.impressions || 0), 0)
  const totalClicks = campaign.reports.reduce((s, r) => s + (r.clicks || 0), 0)
  const totalConv   = campaign.reports.reduce((s, r) => s + (r.conversions || 0), 0)
  const roas        = totalSpend > 0 ? totalRev / totalSpend : 0
  const ctr         = totalImp > 0 ? (totalClicks / totalImp) * 100 : 0

  const countries = campaign.targetCountries
    ? (JSON.parse(campaign.targetCountries) as string[])
    : []
  const totalAds = campaign.adGroups.reduce((s, g) => s + g.ads.length, 0)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/campaigns" className="text-sm text-blue-600 hover:underline">← Back to Campaigns</Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            <Badge variant={statusVariant(campaign.status)}>{campaign.status}</Badge>
          </div>
          <p className="text-gray-500 text-sm mt-1 capitalize">
            {campaign.platform} · {campaign.objective || 'no objective'}
            {countries.length > 0 && ` · ${countries.join(', ')}`}
          </p>
        </div>
        <div className="flex gap-2">
          {campaign.status === 'active' && (
            <Button variant="outline" onClick={toggleStatus}>Pause</Button>
          )}
          {campaign.status === 'paused' && (
            <Button onClick={toggleStatus}>Resume</Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="py-4">
          <p className="text-xs text-gray-500">Spend</p>
          <p className="text-xl font-bold mt-1">{formatCurrency(totalSpend)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <p className="text-xs text-gray-500">Revenue</p>
          <p className="text-xl font-bold mt-1">{formatCurrency(totalRev)}</p>
          <p className="text-xs text-gray-400 mt-1">ROAS {roas.toFixed(2)}x</p>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <p className="text-xs text-gray-500">Impressions</p>
          <p className="text-xl font-bold mt-1">{formatNumber(totalImp)}</p>
          <p className="text-xs text-gray-400 mt-1">CTR {ctr.toFixed(2)}%</p>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <p className="text-xs text-gray-500">Clicks</p>
          <p className="text-xl font-bold mt-1">{formatNumber(totalClicks)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <p className="text-xs text-gray-500">Conversions</p>
          <p className="text-xl font-bold mt-1">{formatNumber(totalConv)}</p>
        </CardContent></Card>
      </div>

      {/* Budgets */}
      <Card>
        <CardHeader><CardTitle>Budgets</CardTitle></CardHeader>
        <CardContent>
          {campaign.budgets.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No budget configured. Add one on the Budget page.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Amount</th>
                  <th className="pb-2 font-medium">Spent</th>
                  <th className="pb-2 font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {campaign.budgets.map(b => (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="py-2 capitalize">{b.type}</td>
                    <td className="py-2">{formatCurrency(b.amount, b.currency)}</td>
                    <td className="py-2">{formatCurrency(b.spent, b.currency)}</td>
                    <td className="py-2">{formatCurrency(b.amount - b.spent, b.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Ad Groups + Ads */}
      <Card>
        <CardHeader><CardTitle>Ad Groups & Ads ({totalAds})</CardTitle></CardHeader>
        <CardContent>
          {campaign.adGroups.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              No ad groups yet. Attach a creative to this campaign from the Creatives page.
            </p>
          ) : (
            <div className="space-y-4">
              {campaign.adGroups.map(g => (
                <div key={g.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-medium">{g.name}</p>
                      <p className="text-xs text-gray-500">{g.ads.length} ad{g.ads.length === 1 ? '' : 's'}</p>
                    </div>
                    <Badge variant={statusVariant(g.status)}>{g.status}</Badge>
                  </div>
                  {g.ads.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {g.ads.map(ad => (
                        <div key={ad.id} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                          {ad.creative?.fileUrl && (
                            <div className="w-16 h-16 flex-shrink-0 bg-gray-200 rounded overflow-hidden">
                              {ad.creative.type === 'video' ? (
                                <video src={ad.creative.fileUrl} muted className="w-full h-full object-cover" />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={ad.creative.fileUrl} alt={ad.creative.name} className="w-full h-full object-cover" />
                              )}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{ad.name}</p>
                            {ad.headline && <p className="text-xs text-gray-700 mt-0.5 truncate">{ad.headline}</p>}
                            {ad.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{ad.description}</p>}
                            <Badge variant={statusVariant(ad.status)} className="mt-1">{ad.status}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reports */}
      <Card>
        <CardHeader><CardTitle>Recent Performance</CardTitle></CardHeader>
        <CardContent>
          {campaign.reports.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No performance data yet. Run Sync Data on the dashboard.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Imp.</th>
                    <th className="pb-2 font-medium">Clicks</th>
                    <th className="pb-2 font-medium">Conv.</th>
                    <th className="pb-2 font-medium">Spend</th>
                    <th className="pb-2 font-medium">Revenue</th>
                    <th className="pb-2 font-medium">CTR</th>
                    <th className="pb-2 font-medium">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {campaign.reports
                    .slice()
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map(r => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2">{r.date.slice(0, 10)}</td>
                        <td className="py-2">{formatNumber(r.impressions)}</td>
                        <td className="py-2">{formatNumber(r.clicks)}</td>
                        <td className="py-2">{formatNumber(r.conversions)}</td>
                        <td className="py-2">{formatCurrency(r.spend)}</td>
                        <td className="py-2">{formatCurrency(r.revenue)}</td>
                        <td className="py-2">{r.ctr.toFixed(2)}%</td>
                        <td className="py-2">{r.roas.toFixed(2)}x</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
