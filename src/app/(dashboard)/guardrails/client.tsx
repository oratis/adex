'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

const RULES = [
  { value: 'budget_max_daily', desc: 'Per-campaign daily-budget ceiling. config: { max: 500 }' },
  { value: 'budget_max_total_daily', desc: 'Org daily-budget ceiling across all campaigns. config: { max: 5000 }' },
  { value: 'budget_change_pct', desc: 'Cap on % delta per budget change. config: { maxIncreasePct: 50, maxDecreasePct: 70 }' },
  { value: 'status_change', desc: 'Force approval for given tools. config: { requireApprovalFor: ["resume_campaign"] }' },
  { value: 'high_risk_requires_approval', desc: 'All tools with riskLevel=high need approval. config: {}' },
  { value: 'agent_active_hours', desc: 'Run only inside this UTC window. config: { startHourUtc: 9, endHourUtc: 18 }' },
  { value: 'llm_budget_cap', desc: 'Stops the agent when monthly LLM spend hits AgentConfig.monthlyLlmBudgetUsd' },
  { value: 'managed_only', desc: 'Block any step that touches a campaign with managedByAgent=false' },
  { value: 'cooldown', desc: 'Block exact-duplicate step within N hours. config: { hours: 4 }' },
  { value: 'pause_only_with_conversions', desc: 'Refuse pause when sample size is too small. config: { minSpendThreshold: 50, minImpressionsForSignal: 2000 }' },
  { value: 'max_per_day', desc: 'Cap daily executions per tool. config: { max: 20 }' },
  { value: 'requires_approval_above_spend', desc: 'Force approval when |Δbudget| ≥ threshold. config: { threshold: 200 }' },
] as const

type Guardrail = {
  id: string
  scope: string
  scopeId: string | null
  rule: string
  config: string
  isActive: boolean
  createdAt: string
}

export function GuardrailsClient({
  role,
  initial,
}: {
  role: string
  initial: Guardrail[]
}) {
  const [rows, setRows] = useState(initial)
  const [showNew, setShowNew] = useState(false)
  const [draft, setDraft] = useState({ scope: 'global', scopeId: '', rule: 'budget_max_daily', config: '{}' })
  const [busy, setBusy] = useState(false)
  const isAdmin = role === 'owner' || role === 'admin'

  async function create() {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft.config || '{}')
    } catch {
      alert('config must be valid JSON')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(api('/api/agent/guardrails'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: draft.scope,
          scopeId: draft.scope === 'global' ? null : draft.scopeId,
          rule: draft.rule,
          config: parsed,
        }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        setRows([
          {
            id: data.id,
            scope: data.scope,
            scopeId: data.scopeId,
            rule: data.rule,
            config: data.config,
            isActive: data.isActive,
            createdAt: data.createdAt,
          },
          ...rows,
        ])
        setShowNew(false)
      }
    } finally {
      setBusy(false)
    }
  }

  async function toggle(g: Guardrail) {
    const res = await fetch(api(`/api/agent/guardrails/${g.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !g.isActive }),
    })
    const data = await res.json()
    if (data.error) alert(data.error)
    else setRows(rows.map((r) => (r.id === g.id ? { ...r, isActive: !g.isActive } : r)))
  }

  async function remove(g: Guardrail) {
    if (!confirm('Delete this guardrail?')) return
    const res = await fetch(api(`/api/agent/guardrails/${g.id}`), { method: 'DELETE' })
    const data = await res.json()
    if (data.error) alert(data.error)
    else setRows(rows.filter((r) => r.id !== g.id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Guardrails</h1>
          <p className="text-sm text-gray-600 mt-1">
            Hard rules the agent cannot violate. The 12 built-in evaluators run on every step;
            org-level rules below extend or tighten them.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowNew(!showNew)}>{showNew ? 'Cancel' : 'New guardrail'}</Button>
        )}
      </div>

      {showNew && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>New guardrail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="block">
                Scope
                <select
                  value={draft.scope}
                  onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                  className="block w-full border rounded px-2 py-1 mt-1"
                >
                  <option value="global">global</option>
                  <option value="platform">platform</option>
                  <option value="campaign">campaign</option>
                </select>
              </label>
              {draft.scope !== 'global' && (
                <label className="block">
                  Scope ID
                  <input
                    value={draft.scopeId}
                    onChange={(e) => setDraft({ ...draft, scopeId: e.target.value })}
                    className="block w-full border rounded px-2 py-1 mt-1"
                    placeholder={draft.scope === 'platform' ? 'google | meta | tiktok' : 'cuid…'}
                  />
                </label>
              )}
              <label className="col-span-2 block">
                Rule
                <select
                  value={draft.rule}
                  onChange={(e) => {
                    setDraft({ ...draft, rule: e.target.value })
                  }}
                  className="block w-full border rounded px-2 py-1 mt-1"
                >
                  {RULES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.value}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-gray-500 block mt-1">
                  {RULES.find((r) => r.value === draft.rule)?.desc}
                </span>
              </label>
              <label className="col-span-2 block">
                Config (JSON)
                <textarea
                  value={draft.config}
                  onChange={(e) => setDraft({ ...draft, config: e.target.value })}
                  className="block w-full border rounded px-2 py-1 mt-1 font-mono text-xs"
                  rows={4}
                  spellCheck={false}
                />
              </label>
            </div>
            <Button onClick={create} disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-gray-500">
            No org-level guardrails. The 12 built-in evaluators are still active.
          </p>
        )}
        {rows.map((g) => (
          <Card key={g.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge>{g.rule}</Badge>
                    <Badge className="bg-gray-100 text-gray-700">{g.scope}{g.scopeId ? `:${g.scopeId}` : ''}</Badge>
                    {!g.isActive && (
                      <Badge className="bg-gray-200 text-gray-600">disabled</Badge>
                    )}
                  </div>
                  <pre className="font-mono text-[11px] bg-gray-50 p-2 rounded whitespace-pre-wrap break-all">
                    {g.config}
                  </pre>
                </div>
                {isAdmin && (
                  <div className="flex flex-col gap-1">
                    <Button variant="ghost" onClick={() => toggle(g)}>
                      {g.isActive ? 'Disable' : 'Enable'}
                    </Button>
                    <Button variant="ghost" onClick={() => remove(g)}>
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
