'use client'

import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatCurrency, api } from '@/lib/utils'
import { GrowthTabs, GateBadge, pct, channelLabel } from '../_ui'

interface ChannelRow {
  channel: string
  skan: boolean
  installs: number
  activationRate: number
  d1Rate: number
  d7Rate: number
  subscribers: number
  subscriptionRate: number
  revenue: number
  ltv: number
  cac: number | null
  ecac: number | null
  gate: { decision: string; reasons: string[] }
}

export default function ChannelsPage() {
  const [rows, setRows] = useState<ChannelRow[] | null>(null)
  const [hasData, setHasData] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(api('/api/growth/channels'))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setRows(d.channels ?? []); setHasData(!!d.hasData) })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Growth</h1>
        <p className="text-gray-500 text-sm mt-1">Channel comparison with live $5K-pilot gate status</p>
      </div>

      <GrowthTabs />

      {loading ? (
        <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>
      ) : !hasData ? (
        <Card><CardContent><p className="text-gray-500 text-sm py-6 text-center">No channel data yet — appears once conversion events flow and growth-sync runs.</p></CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Channels</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-3 font-medium">Channel</th>
                    <th className="pb-3 font-medium text-right">Installs</th>
                    <th className="pb-3 font-medium text-right">Act.</th>
                    <th className="pb-3 font-medium text-right">D1</th>
                    <th className="pb-3 font-medium text-right">D7</th>
                    <th className="pb-3 font-medium text-right">Subs</th>
                    <th className="pb-3 font-medium text-right">LTV</th>
                    <th className="pb-3 font-medium text-right">eCAC*</th>
                    <th className="pb-3 font-medium text-right">Gate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows!.map((c) => (
                    <tr key={c.channel} className="border-b last:border-0">
                      <td className="py-3 font-medium">
                        {channelLabel(c.channel)}
                        {c.skan && <span className="ml-2 text-[10px] font-mono text-ai align-middle">SKAN</span>}
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">{c.installs.toLocaleString()}</td>
                      <td className="py-3 text-right font-mono tabular-nums">{pct(c.activationRate)}</td>
                      <td className="py-3 text-right font-mono tabular-nums">{pct(c.d1Rate)}</td>
                      <td className="py-3 text-right font-mono tabular-nums">{pct(c.d7Rate)}</td>
                      <td className="py-3 text-right font-mono tabular-nums">{c.subscribers.toLocaleString()}</td>
                      <td className="py-3 text-right font-mono tabular-nums">{formatCurrency(c.ltv)}</td>
                      <td className="py-3 text-right font-mono tabular-nums">{c.ecac === null ? '—' : formatCurrency(c.ecac)}</td>
                      <td className="py-3 text-right"><GateBadge decision={c.gate.decision} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-4">
              Gate runs <code className="font-mono">pilot-gates.evaluateChannel</code> — the same logic the Agent uses.
              <span className="text-ok"> scale</span> needs real paying users; proxy metrics can only <span className="text-warn">halve</span>/<span className="text-bad">kill</span>.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
