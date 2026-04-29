'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'

type Step = { id: string; toolName: string; input: string; guardrailReport: string | null }
type Approval = {
  id: string
  decisionId: string
  expiresAt: string
  createdAt: string
  decision: { rationale: string; severity: string; steps: Step[] }
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-gray-100 text-gray-700',
  opportunity: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  alert: 'bg-rose-100 text-rose-700',
}

export function ApprovalsClient({
  role,
  approvals,
}: {
  role: string
  approvals: Approval[]
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [list, setList] = useState(approvals)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const isAdmin = role === 'owner' || role === 'admin'

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  function selectAll() {
    setSelected(new Set(list.map((l) => l.id)))
  }
  function clearSel() {
    setSelected(new Set())
  }

  async function decide(approvalId: string, action: 'approve' | 'reject') {
    setBusy(approvalId)
    let reason: string | null = null
    if (action === 'reject') {
      reason = prompt('Reason for rejection (optional):') || ''
    }
    try {
      const res = await fetch(api(`/api/agent/approvals/${approvalId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        setList(list.filter((l) => l.id !== approvalId))
      }
    } finally {
      setBusy(null)
    }
  }

  async function bulk(action: 'approve' | 'reject') {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} ${ids.length} decision(s)?`))
      return
    let reason: string | null = null
    if (action === 'reject') reason = prompt('Reason for rejection (optional):') || ''
    setBusy('__bulk__')
    try {
      const res = await fetch(api('/api/agent/approvals/bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, reason }),
      })
      const data = await res.json() as { results: { id: string; status: string; error?: string }[] }
      const settled = new Set(
        (data.results || []).filter((r) => r.status !== 'error').map((r) => r.id)
      )
      setList(list.filter((l) => !settled.has(l.id)))
      setSelected(new Set())
      const errors = (data.results || []).filter((r) => r.status === 'error')
      if (errors.length > 0) alert(`${errors.length} failed:\n` + errors.map((e) => `${e.id}: ${e.error}`).join('\n'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pending approvals</h1>
        <p className="text-sm text-gray-600 mt-1">
          Decisions the agent wants to take but that need a human green light. Approving runs the
          tools immediately. Rejecting closes the decision with no platform-side change.
        </p>
      </div>

      {!isAdmin && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
          You&apos;re a member — approve/reject is owner/admin only. You can still view the queue.
        </p>
      )}

      {list.length === 0 && (
        <EmptyState
          emoji="✨"
          title="Nothing waiting on you · 都处理完了"
          description="No pending agent decisions need your approval right now. The agent will queue new ones here when guardrails block its proposed actions."
        />
      )}

      {isAdmin && list.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">{selected.size} selected</span>
          <Button variant="ghost" onClick={selectAll}>
            Select all
          </Button>
          <Button variant="ghost" onClick={clearSel}>
            Clear
          </Button>
          <Button onClick={() => bulk('approve')} disabled={selected.size === 0 || busy === '__bulk__'}>
            Approve selected
          </Button>
          <Button
            variant="outline"
            onClick={() => bulk('reject')}
            disabled={selected.size === 0 || busy === '__bulk__'}
          >
            Reject selected
          </Button>
        </div>
      )}

      {sortByUrgency(list).map((a) => {
        const stripe = SEVERITY_STRIPE[a.decision.severity] || 'border-l-gray-300'
        const elapsedH = (Date.now() - new Date(a.createdAt).getTime()) / 3_600_000
        const remainingH = (new Date(a.expiresAt).getTime() - Date.now()) / 3_600_000
        const isStale = elapsedH > 24
        const isExpiring = remainingH < 12 && remainingH > 0
        return (
        <Card key={a.id} className={`border-l-4 ${stripe}`}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {isAdmin && (
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={() => toggle(a.id)}
                  className="mr-1"
                />
              )}
              <Badge className={SEVERITY_COLORS[a.decision.severity] || ''}>
                {a.decision.severity}
              </Badge>
              {isStale && (
                <Badge className="bg-amber-100 text-amber-700">⏱ {elapsedH.toFixed(0)}h old</Badge>
              )}
              {isExpiring && (
                <Badge className="bg-rose-100 text-rose-700">
                  ⚠ expires in {remainingH.toFixed(0)}h
                </Badge>
              )}
              <span className="text-xs text-gray-500">
                created {new Date(a.createdAt).toLocaleString()} · expires{' '}
                {new Date(a.expiresAt).toLocaleString()}
              </span>
            </div>
            <p className="text-sm">{a.decision.rationale}</p>
            <div className="space-y-2">
              {a.decision.steps.map((s) => (
                <div key={s.id} className="border rounded p-2 text-xs bg-gray-50">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge>{s.toolName}</Badge>
                  </div>
                  <pre className="font-mono whitespace-pre-wrap break-all text-[10px]">
                    {s.input}
                  </pre>
                  {s.guardrailReport && (
                    <details className="mt-1">
                      <summary className="cursor-pointer">guardrails</summary>
                      <pre className="font-mono whitespace-pre-wrap break-all text-[10px]">
                        {s.guardrailReport}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <Button
                  onClick={() => decide(a.id, 'approve')}
                  disabled={busy === a.id}
                >
                  {busy === a.id ? 'Working…' : 'Approve & run'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => decide(a.id, 'reject')}
                  disabled={busy === a.id}
                >
                  Reject
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        )
      })}
    </div>
  )
}

const SEVERITY_RANK: Record<string, number> = { alert: 0, warning: 1, opportunity: 2, info: 3 }

const SEVERITY_STRIPE: Record<string, string> = {
  alert: 'border-l-rose-500',
  warning: 'border-l-amber-500',
  opportunity: 'border-l-emerald-500',
  info: 'border-l-gray-300',
}

function sortByUrgency(items: Approval[]): Approval[] {
  return [...items].sort((a, b) => {
    const sa = SEVERITY_RANK[a.decision.severity] ?? 99
    const sb = SEVERITY_RANK[b.decision.severity] ?? 99
    if (sa !== sb) return sa - sb
    // Same severity → older = more urgent (about to expire)
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}
