'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

type Stats = {
  windowDays: number
  enabled: boolean
  mode: string
  killSwitch: boolean
  decisionsTotal: number
  pendingApprovals: number
  byStatus: Record<string, number>
  bySeverity: Record<string, number>
  byMode: Record<string, number>
  byTrigger: Record<string, number>
  topTools: Array<{ name: string; count: number }>
  toolStatus: Record<string, number>
  outcomes: Record<string, number>
  llmCostUsd: number
  inputTokens: number
  outputTokens: number
  approvalLatency: {
    sampleSize: number
    medianMinutes: number
    p95Minutes: number
    maxMinutes: number
  }
}

function Distribution({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (total === 0) return null
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1 text-xs">
        {entries.map(([k, n]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-32 truncate">{k}</span>
            <div className="flex-1 bg-gray-100 rounded h-2 overflow-hidden">
              <div
                className="bg-blue-500 h-full"
                style={{ width: `${(n / total) * 100}%` }}
              />
            </div>
            <span className="w-12 text-right text-gray-600">{n}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function fmtMinutes(m: number): string {
  if (m < 1) return `${Math.round(m * 60)}s`
  if (m < 60) return `${m.toFixed(0)}m`
  if (m < 24 * 60) return `${(m / 60).toFixed(1)}h`
  return `${(m / 60 / 24).toFixed(1)}d`
}

export function StatsClient() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!cancelled) setLoading(true)
      try {
        const res = await fetch(api(`/api/agent/stats?days=${days}`))
        const j = (await res.json()) as Stats
        if (!cancelled) setData(j)
      } catch {
        // surface via "Loading…" cleared in finally
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [days])

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Agent stats</h1>
          <p className="text-sm text-gray-600 mt-1">
            Aggregated activity for this org. Drives the weekly digest and gives a quick read on
            whether the agent is healthy enough to upgrade modes.
          </p>
        </div>
        <label className="text-sm">
          Window
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="ml-2 border rounded px-2 py-1"
          >
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="py-4">
                <div className="text-xs uppercase text-gray-500">Mode</div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    className={
                      data.killSwitch
                        ? 'bg-rose-100 text-rose-700'
                        : data.enabled
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-600'
                    }
                  >
                    {data.killSwitch ? 'kill-switch' : data.enabled ? data.mode : 'disabled'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="text-xs uppercase text-gray-500">Decisions</div>
                <div className="text-2xl font-bold">{data.decisionsTotal}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="text-xs uppercase text-gray-500">Pending approval</div>
                <div className="text-2xl font-bold">{data.pendingApprovals}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="text-xs uppercase text-gray-500">LLM cost</div>
                <div className="text-2xl font-bold">${data.llmCostUsd.toFixed(2)}</div>
                <div className="text-xs text-gray-500">
                  {data.inputTokens.toLocaleString()} in / {data.outputTokens.toLocaleString()} out
                </div>
              </CardContent>
            </Card>
          </div>

          {data.approvalLatency.sampleSize > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Approval response time</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-gray-500 uppercase">Median</div>
                  <div className="text-lg font-bold">{fmtMinutes(data.approvalLatency.medianMinutes)}</div>
                </div>
                <div>
                  <div className="text-gray-500 uppercase">p95</div>
                  <div className="text-lg font-bold">{fmtMinutes(data.approvalLatency.p95Minutes)}</div>
                </div>
                <div>
                  <div className="text-gray-500 uppercase">Max</div>
                  <div className="text-lg font-bold">{fmtMinutes(data.approvalLatency.maxMinutes)}</div>
                </div>
                <div className="col-span-3 text-gray-500">
                  Based on {data.approvalLatency.sampleSize} resolved approvals; auto-expired
                  (72h) excluded.
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Distribution title="By status" counts={data.byStatus} />
            <Distribution title="By severity" counts={data.bySeverity} />
            <Distribution title="By mode" counts={data.byMode} />
            <Distribution title="By trigger" counts={data.byTrigger} />
            <Distribution title="Verified outcomes" counts={data.outcomes} />
            <Distribution title="Tool step status" counts={data.toolStatus} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Top tools</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody>
                  {data.topTools.map((t) => (
                    <tr key={t.name} className="border-t border-gray-100">
                      <td className="py-1 font-mono text-xs">{t.name}</td>
                      <td className="text-right">{t.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
