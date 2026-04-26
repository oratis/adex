'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

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
        <p className="text-sm text-gray-500">Nothing waiting on you. Nice.</p>
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

      {list.map((a) => (
        <Card key={a.id}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
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
      ))}
    </div>
  )
}
