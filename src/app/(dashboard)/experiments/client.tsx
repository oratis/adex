'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

type Arm = { name: string; adLinkId: string; trafficShare: number }
type Experiment = {
  id: string
  campaignLinkId: string
  hypothesis: string
  status: string
  startedAt: string
  endsAt: string
  primaryMetric: string
  minSampleSize: number
  result: string | null
  arms: Arm[]
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  aborted: 'bg-gray-100 text-gray-600',
}

export function ExperimentsClient({
  role,
  experiments,
}: {
  role: string
  experiments: Experiment[]
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [list, setList] = useState(experiments)
  const isAdmin = role === 'owner' || role === 'admin'

  async function conclude(id: string) {
    setBusy(id)
    try {
      const res = await fetch(api(`/api/agent/experiments/${id}/conclude`), { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        setList(
          list.map((e) =>
            e.id === id
              ? { ...e, status: 'completed', result: JSON.stringify(data.result) }
              : e
          )
        )
      }
    } finally {
      setBusy(null)
    }
  }

  function parseResult(raw: string | null) {
    if (!raw) return null
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">A/B experiments</h1>
        <p className="text-sm text-gray-600 mt-1">
          Two-arm tests against a campaign. Conclude runs a two-proportion z-test on the primary
          metric (ctr or cvr) and stores the winning arm + p-value on the experiment record.
        </p>
      </div>

      {list.length === 0 && (
        <p className="text-sm text-gray-500">
          No experiments yet. Use the <code>start_experiment</code> agent tool or POST{' '}
          <code>/api/agent/experiments</code>.
        </p>
      )}

      {list.map((e) => {
        const res = parseResult(e.result)
        const elapsedHours = (Date.now() - new Date(e.startedAt).getTime()) / 3_600_000
        return (
          <Card key={e.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge className={STATUS_COLORS[e.status] || ''}>{e.status}</Badge>
                    <Badge>{e.primaryMetric}</Badge>
                    <span className="text-xs text-gray-500">
                      started {new Date(e.startedAt).toLocaleString()} · ends{' '}
                      {new Date(e.endsAt).toLocaleString()} (
                      {elapsedHours.toFixed(0)}h elapsed)
                    </span>
                  </div>
                  <p className="text-sm text-gray-900">{e.hypothesis}</p>

                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {e.arms.map((arm) => (
                      <div key={arm.name} className="border rounded p-2 text-xs">
                        <div className="flex items-center gap-2">
                          <Badge>{arm.name}</Badge>
                          <span className="text-gray-500">{(arm.trafficShare * 100).toFixed(0)}%</span>
                        </div>
                        <div className="font-mono mt-1 text-[10px] text-gray-600 break-all">
                          adLinkId: {arm.adLinkId}
                        </div>
                      </div>
                    ))}
                  </div>

                  {res && (
                    <div className="mt-3 border rounded p-3 text-xs bg-gray-50">
                      <div className="font-semibold mb-1">Result</div>
                      {res.winner ? (
                        <p>
                          <strong>Winner:</strong> {String(res.winner)} (lift{' '}
                          {typeof res.liftPct === 'number' ? `${res.liftPct.toFixed(1)}%` : '—'},
                          p={typeof res.pTwoSided === 'number' ? res.pTwoSided.toExponential(2) : '—'})
                        </p>
                      ) : (
                        <p>Not significant — see full result blob below.</p>
                      )}
                      <pre className="font-mono whitespace-pre-wrap break-all mt-2 text-[10px]">
                        {JSON.stringify(res, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
                {isAdmin && e.status === 'running' && (
                  <Button onClick={() => conclude(e.id)} disabled={busy === e.id}>
                    {busy === e.id ? 'Concluding…' : 'Conclude now'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
