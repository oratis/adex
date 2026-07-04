'use client'

import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { StatCard } from '@/components/layout/stat-card'
import { formatCurrency, api } from '@/lib/utils'
import { GrowthTabs, pct, channelLabel } from './_ui'

interface FunnelShape {
  installs: number
  activated: number
  activationRate: number
  d1Rate: number
  d7Rate: number
  trials: number
  subscribers: number
  subscriptionRate: number
  revenue: number
  ltv: number
}

interface ChannelRow extends FunnelShape {
  channel: string
  cac: number | null
}

interface Overview {
  hasData: boolean
  funnel: FunnelShape
  channels: ChannelRow[]
  updatedAt: string | null
}

export default function GrowthPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(api('/api/growth/overview'))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  const f = data?.funnel

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Growth</h1>
          <p className="text-gray-500 text-sm mt-1">
            Install → activation → retention → subscription funnel, by acquisition channel
          </p>
        </div>
        {data?.updatedAt && (
          <p className="text-xs text-gray-400 font-mono">
            updated {new Date(data.updatedAt).toLocaleString()}
          </p>
        )}
      </div>

      <GrowthTabs />

      {loading ? (
        <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>
      ) : error ? (
        <Card>
          <CardContent>
            <p className="text-gray-500 text-sm py-6 text-center">Couldn’t load growth data. Try again shortly.</p>
          </CardContent>
        </Card>
      ) : !data?.hasData ? (
        <Card>
          <CardHeader>
            <CardTitle>No cohort data yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-500 text-sm py-2">
              Cohorts appear once conversion events are flowing (GA4 + RevenueCat ingest) and the
              nightly <code>growth-sync</code> has run. This is expected before the app goes live.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard title="Installs" value={f!.installs.toLocaleString()} icon={<span>📲</span>} />
            <StatCard title="Activation" value={pct(f!.activationRate)} icon={<span>💬</span>} />
            <StatCard title="D1" value={pct(f!.d1Rate)} icon={<span>🔁</span>} />
            <StatCard title="D7" value={pct(f!.d7Rate)} icon={<span>📅</span>} />
            <StatCard title="Subscribers" value={f!.subscribers.toLocaleString()} icon={<span>⭐</span>} />
            <StatCard title="Revenue" value={formatCurrency(f!.revenue)} icon={<span>💵</span>} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>By channel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="pb-3 font-medium">Channel</th>
                      <th className="pb-3 font-medium text-right">Installs</th>
                      <th className="pb-3 font-medium text-right">Activation</th>
                      <th className="pb-3 font-medium text-right">D1</th>
                      <th className="pb-3 font-medium text-right">D7</th>
                      <th className="pb-3 font-medium text-right">Subs</th>
                      <th className="pb-3 font-medium text-right">Sub %</th>
                      <th className="pb-3 font-medium text-right">LTV</th>
                      <th className="pb-3 font-medium text-right">CAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.channels.map((c) => (
                      <tr key={c.channel} className="border-b last:border-0">
                        <td className="py-3 font-medium">{channelLabel(c.channel)}</td>
                        <td className="py-3 text-right">{c.installs.toLocaleString()}</td>
                        <td className="py-3 text-right">{pct(c.activationRate)}</td>
                        <td className="py-3 text-right">{pct(c.d1Rate)}</td>
                        <td className="py-3 text-right">{pct(c.d7Rate)}</td>
                        <td className="py-3 text-right">{c.subscribers.toLocaleString()}</td>
                        <td className="py-3 text-right">{pct(c.subscriptionRate)}</td>
                        <td className="py-3 text-right">{formatCurrency(c.ltv)}</td>
                        <td className="py-3 text-right">{c.cac === null ? '—' : formatCurrency(c.cac)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
