'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

type Cost = {
  month: string
  monthlyBudgetUsd: number
  monthlySpentUsd: number
  decisionsThisMonth: number
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  perVersion: Array<{
    promptVersionId: string
    name: string
    version: number
    runs: number
    inputTokens: number
    outputTokens: number
    costUsd: number
    parsedRate: number
    avgLatencyMs: number
  }>
  perDay: Array<{ date: string; costUsd: number; runs: number }>
}

function ymToInputValue(ym: string): string {
  return ym // already YYYY-MM
}

function defaultMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function CostClient() {
  const [month, setMonth] = useState<string>(defaultMonth())
  const [data, setData] = useState<Cost | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Defer the loading flip into the async block so the synchronous useEffect
      // body doesn't trigger the cascading-renders lint.
      if (!cancelled) setLoading(true)
      try {
        const res = await fetch(api(`/api/agent/cost?month=${month}`))
        const j = await res.json()
        if (!cancelled) setData(j)
      } catch {
        // swallow — surface via "Loading…" cleared in finally
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [month])

  const utilization = data && data.monthlyBudgetUsd > 0
    ? (data.monthlySpentUsd / data.monthlyBudgetUsd) * 100
    : 0

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Agent LLM cost</h1>
          <p className="text-sm text-gray-600 mt-1">
            Per-org breakdown of plan() calls and downstream PromptRun costs. Hard cap is enforced
            by the <code>llm_budget_cap</code> guardrail.
          </p>
        </div>
        <label className="text-sm">
          Month
          <input
            type="month"
            value={ymToInputValue(month)}
            onChange={(e) => setMonth(e.target.value)}
            className="ml-2 border rounded px-2 py-1"
          />
        </label>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="py-4">
                <div className="text-xs uppercase text-gray-500">Spent</div>
                <div className="text-2xl font-bold">${data.monthlySpentUsd.toFixed(2)}</div>
                <div className="text-xs text-gray-500">of ${data.monthlyBudgetUsd.toFixed(2)} cap</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="text-xs uppercase text-gray-500">Utilization</div>
                <div className="text-2xl font-bold">{utilization.toFixed(0)}%</div>
                <Badge
                  className={
                    utilization > 90
                      ? 'bg-rose-100 text-rose-700'
                      : utilization > 60
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }
                >
                  {utilization > 90 ? 'critical' : utilization > 60 ? 'warming' : 'ok'}
                </Badge>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="text-xs uppercase text-gray-500">Decisions</div>
                <div className="text-2xl font-bold">{data.decisionsThisMonth}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="text-xs uppercase text-gray-500">Tokens (in / out)</div>
                <div className="text-lg font-bold">
                  {data.totalInputTokens.toLocaleString()} /{' '}
                  {data.totalOutputTokens.toLocaleString()}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Per prompt version</CardTitle>
            </CardHeader>
            <CardContent>
              {data.perVersion.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No DB-backed PromptRun rows this month — disk fallback in use.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="py-1">Prompt</th>
                      <th>Runs</th>
                      <th>In tokens</th>
                      <th>Out tokens</th>
                      <th>Cost</th>
                      <th>Parsed</th>
                      <th>Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perVersion.map((b) => (
                      <tr key={b.promptVersionId} className="border-t border-gray-100">
                        <td className="py-1 font-mono text-xs">{b.name} v{b.version}</td>
                        <td>{b.runs}</td>
                        <td>{b.inputTokens.toLocaleString()}</td>
                        <td>{b.outputTokens.toLocaleString()}</td>
                        <td>${b.costUsd.toFixed(3)}</td>
                        <td>{(b.parsedRate * 100).toFixed(0)}%</td>
                        <td>{b.avgLatencyMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Per day</CardTitle>
            </CardHeader>
            <CardContent>
              {data.perDay.length === 0 ? (
                <p className="text-sm text-gray-500">No spend this month yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th>Date</th>
                      <th>Decisions</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perDay.map((d) => (
                      <tr key={d.date} className="border-t border-gray-100">
                        <td className="font-mono text-xs">{d.date}</td>
                        <td>{d.runs}</td>
                        <td>${d.costUsd.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
