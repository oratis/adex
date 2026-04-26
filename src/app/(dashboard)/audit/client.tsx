'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { describeAuditEvent, actionLabel } from '@/lib/humanize'

type Event = {
  id: string
  action: string
  userId: string | null
  targetType: string | null
  targetId: string | null
  metadata: string | null
  ipAddress: string | null
  createdAt: string
}

const ACTION_COLORS: Record<string, string> = {
  'campaign.launch': 'bg-emerald-100 text-emerald-700',
  'campaign.pause': 'bg-amber-100 text-amber-700',
  'campaign.resume': 'bg-emerald-100 text-emerald-700',
  'campaign.delete': 'bg-rose-100 text-rose-700',
  'platform.connect': 'bg-blue-100 text-blue-700',
  'platform.disconnect': 'bg-rose-100 text-rose-700',
  'advisor.apply': 'bg-purple-100 text-purple-700',
  'member.invite': 'bg-blue-100 text-blue-700',
  'member.remove': 'bg-rose-100 text-rose-700',
  'cron.daily': 'bg-gray-100 text-gray-600',
}

export function AuditClient({
  role,
  events,
  filter,
}: {
  role: string
  events: Event[]
  filter: { action: string | null; targetType: string | null }
}) {
  void role

  function setParam(key: string, value: string) {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
    window.location.href = url.toString()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-gray-600 mt-1">
          Append-only record of every consequential action in this org. Useful for incident
          forensics and compliance review. Most recent 200 events shown.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">Filter:</span>
        <select
          value={filter.action || ''}
          onChange={(e) => setParam('action', e.target.value)}
          className="border rounded px-2 py-1"
        >
          <option value="">all actions</option>
          {Object.keys(ACTION_COLORS).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
          <option value="campaign.create">campaign.create</option>
          <option value="campaign.update">campaign.update</option>
          <option value="creative.create">creative.create</option>
        </select>
        <select
          value={filter.targetType || ''}
          onChange={(e) => setParam('targetType', e.target.value)}
          className="border rounded px-2 py-1"
        >
          <option value="">all targets</option>
          <option value="campaign">campaign</option>
          <option value="ad">ad</option>
          <option value="creative">creative</option>
          <option value="decision">decision</option>
          <option value="agent_config">agent_config</option>
          <option value="guardrail">guardrail</option>
          <option value="approval_bulk">approval_bulk</option>
          <option value="campaign_bulk">campaign_bulk</option>
        </select>
        {(filter.action || filter.targetType) && (
          <Button variant="ghost" onClick={() => (window.location.href = '/audit')}>
            Clear
          </Button>
        )}
      </div>

      {events.length === 0 && <p className="text-sm text-gray-500">No matching events.</p>}

      <div className="space-y-2">
        {events.map((e) => {
          const sentence = describeAuditEvent({
            action: e.action,
            userName: e.userId ? e.userId.slice(0, 8) : null,
            targetType: e.targetType,
            targetSummary: e.targetId ? e.targetId.slice(0, 8) : null,
          })
          const a = actionLabel(e.action)
          return (
          <Card key={e.id}>
            <CardContent className="p-3 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  className={ACTION_COLORS[e.action] || 'bg-gray-100 text-gray-700'}
                  title={e.action}
                >
                  {a.zh}
                </Badge>
                {e.ipAddress && <span className="text-gray-400">{e.ipAddress}</span>}
                <span className="text-gray-400 ml-auto">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-1.5 text-sm text-gray-900">{sentence.zh}</div>
              <div className="text-[10px] text-gray-400">{sentence.en}</div>
              {e.metadata && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-gray-500">metadata</summary>
                  <pre className="font-mono whitespace-pre-wrap break-all bg-gray-50 p-2 rounded mt-1">
                    {e.metadata}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
          )
        })}
      </div>
    </div>
  )
}
