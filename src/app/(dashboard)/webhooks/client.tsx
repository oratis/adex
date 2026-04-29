'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'

type Delivery = {
  id: string
  webhookUrl: string
  event: string
  attempts: number
  maxAttempts: number
  nextAttemptAt: string
  succeededAt: string | null
  abandonedAt: string | null
  lastStatusCode: number | null
  lastError: string | null
  createdAt: string
}

export function WebhookDeliveriesClient({
  role,
  deliveries,
  filterStatus,
}: {
  role: string
  deliveries: Delivery[]
  filterStatus: string
}) {
  const [list, setList] = useState(deliveries)
  const [busy, setBusy] = useState<string | null>(null)
  const isAdmin = role === 'owner' || role === 'admin'

  function setStatus(s: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('status', s)
    window.location.href = url.toString()
  }

  async function retry(id: string) {
    setBusy(id)
    try {
      const res = await fetch(api(`/api/orgs/webhooks/deliveries/${id}/retry`), { method: 'POST' })
      const data = await res.json()
      if (data.error) alert(data.error)
      else setList(list.filter((d) => d.id !== id))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Webhook deliveries</h1>
        <p className="text-sm text-gray-600 mt-1">
          Failed deliveries are retried with exponential backoff (60s → 12h, capped at 5 attempts).
          Abandoned rows can be force-requeued from here.
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-600">Filter:</span>
        {['pending', 'abandoned', 'succeeded'].map((s) => (
          <Button
            key={s}
            variant={filterStatus === s ? 'primary' : 'ghost'}
            onClick={() => setStatus(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      {list.length === 0 && (
        <EmptyState
          emoji="📡"
          title={`No ${filterStatus} deliveries · 没有 ${filterStatus} 投递`}
          description={
            filterStatus === 'pending'
              ? 'No webhook deliveries are currently retrying. Add a webhook in /settings → Webhooks to start.'
              : filterStatus === 'abandoned'
              ? 'Nothing has hit max attempts. The retry queue is healthy.'
              : 'No successful deliveries on record (yet).'
          }
        />
      )}

      <div className="space-y-2">
        {list.map((d) => (
          <Card key={d.id}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge>{d.event}</Badge>
                {d.lastStatusCode != null && (
                  <Badge className="bg-gray-100 text-gray-700">HTTP {d.lastStatusCode}</Badge>
                )}
                <Badge className="bg-blue-100 text-blue-700">
                  attempt {d.attempts}/{d.maxAttempts}
                </Badge>
                <span className="text-xs text-gray-500 ml-auto">
                  {d.succeededAt
                    ? `succeeded ${new Date(d.succeededAt).toLocaleString()}`
                    : d.abandonedAt
                    ? `abandoned ${new Date(d.abandonedAt).toLocaleString()}`
                    : `next ${new Date(d.nextAttemptAt).toLocaleString()}`}
                </span>
              </div>
              <p className="text-xs font-mono text-gray-700 break-all">{d.webhookUrl}</p>
              {d.lastError && (
                <p className="text-xs text-rose-700 bg-rose-50 p-2 rounded font-mono">
                  {d.lastError}
                </p>
              )}
              {isAdmin && d.abandonedAt && (
                <Button onClick={() => retry(d.id)} disabled={busy === d.id}>
                  {busy === d.id ? 'Requeueing…' : 'Requeue now'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
