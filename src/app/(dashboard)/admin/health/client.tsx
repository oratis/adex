'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

type Health = {
  db: { alive: boolean; latencyMs: number }
  queue: { inProcessDepth: number }
  counts: {
    users: number
    orgs: number
    activeAgentOrgs: number
    decisionsLast24h: number
    failedDecisionsLast24h: number
    pendingApprovals: number
    pendingWebhookDeliveries: number
    abandonedWebhookDeliveries: number
    auditEventsLast1h: number
  }
  timestamp: string
}

export function HealthClient() {
  const [data, setData] = useState<Health | null>(null)
  const [loading, setLoading] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const r = await fetch(api('/api/admin/health'))
      if (r.ok) setData(await r.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Platform health · 平台健康</h1>
          <p className="text-sm text-gray-600 mt-1">
            DB latency / queue depth / counters across all orgs. Auto-refreshes every 30s.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-sm text-blue-600 hover:underline disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      {!data && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Database</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge
                  className={
                    data.db.alive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                  }
                >
                  {data.db.alive ? 'alive' : 'down'}
                </Badge>
                {data.db.alive && (
                  <span className="ml-2 text-sm text-gray-600">{data.db.latencyMs}ms</span>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">In-process queue</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                Depth: <strong>{data.queue.inProcessDepth}</strong>
                <div className="text-xs text-gray-500 mt-1">
                  Per-instance only; multi-instance deploy needs Cloud Tasks.
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Snapshot taken</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {new Date(data.timestamp).toLocaleString()}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Counters</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody>
                  <Row label="Total users · 注册用户" value={data.counts.users} />
                  <Row label="Total orgs · 工作区" value={data.counts.orgs} />
                  <Row
                    label="Active agent orgs · 启用 Agent 的 org"
                    value={data.counts.activeAgentOrgs}
                  />
                  <Row label="Decisions (last 24h) · 24h 决策数" value={data.counts.decisionsLast24h} />
                  <Row
                    label="Failed decisions (last 24h) · 24h 失败决策"
                    value={data.counts.failedDecisionsLast24h}
                    warn={data.counts.failedDecisionsLast24h > 5}
                  />
                  <Row label="Pending approvals" value={data.counts.pendingApprovals} />
                  <Row
                    label="Pending webhook deliveries"
                    value={data.counts.pendingWebhookDeliveries}
                  />
                  <Row
                    label="Abandoned webhook deliveries"
                    value={data.counts.abandonedWebhookDeliveries}
                    warn={data.counts.abandonedWebhookDeliveries > 0}
                  />
                  <Row label="Audit events (last 1h)" value={data.counts.auditEventsLast1h} />
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Row({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="py-1.5">{label}</td>
      <td
        className={
          'text-right font-mono ' + (warn ? 'text-rose-700 font-semibold' : 'text-gray-900')
        }
      >
        {value.toLocaleString()}
      </td>
    </tr>
  )
}
