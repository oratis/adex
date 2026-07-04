'use client'

import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatCurrency, api, cn } from '@/lib/utils'
import { GrowthTabs, pct, channelLabel } from '../_ui'

interface CohortRow {
  cohortDate: string
  channel: string
  installs: number
  activationRate: number
  d1Rate: number
  d7Rate: number
  subscribers: number
  subscriptionRate: number
  ltv: number
}

// Heat tint for a retention rate — brighter lime = better (loopback).
function heat(rate: number): string {
  if (rate >= 0.3) return 'text-signal'
  if (rate >= 0.18) return 'text-ok'
  if (rate >= 0.1) return 'text-warn'
  if (rate > 0) return 'text-bad'
  return 'text-dim'
}

export default function CohortsPage() {
  const [rows, setRows] = useState<CohortRow[] | null>(null)
  const [hasData, setHasData] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(api('/api/growth/cohorts'))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setRows(d.rows ?? []); setHasData(!!d.hasData) })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Growth</h1>
        <p className="text-gray-500 text-sm mt-1">Per-acquisition-day cohorts — retention &amp; realized LTV</p>
      </div>

      <GrowthTabs />

      {loading ? (
        <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>
      ) : !hasData ? (
        <Card><CardContent><p className="text-gray-500 text-sm py-6 text-center">No cohorts yet — appears once conversion events flow and growth-sync runs.</p></CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Cohorts</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-3 font-medium">Day</th>
                    <th className="pb-3 font-medium">Channel</th>
                    <th className="pb-3 font-medium text-right">Installs</th>
                    <th className="pb-3 font-medium text-right">Act.</th>
                    <th className="pb-3 font-medium text-right">D1</th>
                    <th className="pb-3 font-medium text-right">D7</th>
                    <th className="pb-3 font-medium text-right">Subs</th>
                    <th className="pb-3 font-medium text-right">LTV</th>
                  </tr>
                </thead>
                <tbody>
                  {rows!.map((c, i) => (
                    <tr key={`${c.cohortDate}-${c.channel}-${i}`} className="border-b last:border-0">
                      <td className="py-2.5 font-mono text-gray-500">{c.cohortDate}</td>
                      <td className="py-2.5">{channelLabel(c.channel)}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">{c.installs.toLocaleString()}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">{pct(c.activationRate)}</td>
                      <td className={cn('py-2.5 text-right font-mono tabular-nums', heat(c.d1Rate))}>{pct(c.d1Rate)}</td>
                      <td className={cn('py-2.5 text-right font-mono tabular-nums', heat(c.d7Rate))}>{pct(c.d7Rate)}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">{c.subscribers.toLocaleString()}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">{formatCurrency(c.ltv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
