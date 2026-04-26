'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

type AgentConfig = {
  enabled: boolean
  mode: string
  killSwitch: boolean
  killSwitchReason: string | null
  monthlyLlmBudgetUsd: number
  monthlyLlmSpentUsd: number
}

type Step = {
  id: string
  toolName: string
  status: string
  input: string
  output: string | null
  guardrailReport: string | null
  reversible: boolean
}

type Decision = {
  id: string
  rationale: string
  severity: string
  mode: string
  status: string
  requiresApproval: boolean
  createdAt: string
  executedAt: string | null
  llmCostUsd: number
  llmInputTokens?: number
  llmOutputTokens?: number
  promptVersion?: string | null
  triggerType?: string
  outcomeClass: string | null
  outcomeDelta?: string | null
  steps: Step[]
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-gray-100 text-gray-700',
  opportunity: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  alert: 'bg-rose-100 text-rose-700',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  executed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  skipped: 'bg-gray-100 text-gray-600',
  rejected: 'bg-gray-200 text-gray-700',
  rolled_back: 'bg-purple-100 text-purple-700',
  executing: 'bg-blue-100 text-blue-700',
}

export function DecisionsClient({
  role,
  config: initialConfig,
  decisions,
  filter,
}: {
  role: string
  config: AgentConfig
  decisions: Decision[]
  filter: {
    status: string | null
    severity: string | null
    campaignId: string | null
    since: string | null
    until: string | null
  }
}) {
  const [config, setConfig] = useState(initialConfig)
  const [running, setRunning] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [campaignDraft, setCampaignDraft] = useState(filter.campaignId || '')
  const isAdmin = role === 'owner' || role === 'admin'

  function setFilter(key: 'status' | 'severity' | 'campaignId' | 'since' | 'until', value: string) {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
    window.location.href = url.toString()
  }

  async function runNow() {
    setRunning(true)
    try {
      const res = await fetch(api('/api/agent/run'), { method: 'POST' })
      const data = await res.json()
      alert(
        `Created ${data.decisionsCreated} · Executed ${data.decisionsExecuted} · Skipped ${data.decisionsSkipped} · Awaiting approval ${data.decisionsAwaitingApproval}` +
          (data.errors?.length ? `\nErrors:\n- ${data.errors.join('\n- ')}` : '')
      )
      window.location.reload()
    } finally {
      setRunning(false)
    }
  }

  async function snapshotNow() {
    setRunning(true)
    try {
      const res = await fetch(api('/api/agent/snapshot'), { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        alert(
          `Snapshots: ${data.snapshots} · Orphans: ${data.orphans} · Drifted: ${data.drifted} · Approvals queued: ${data.approvalsCreated}` +
            (data.errors?.length ? `\nErrors:\n- ${data.errors.join('\n- ')}` : '')
        )
      }
    } finally {
      setRunning(false)
    }
  }

  async function saveConfig(patch: Partial<AgentConfig>) {
    setSavingConfig(true)
    try {
      const res = await fetch(api('/api/agent/config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      setConfig(data)
    } finally {
      setSavingConfig(false)
    }
  }

  async function rollback(id: string) {
    if (!confirm('Roll back every reversible step in this decision?')) return
    const res = await fetch(api(`/api/agent/decisions/${id}/rollback`), { method: 'POST' })
    const data = await res.json()
    if (data.error) alert(data.error)
    else alert(`Rollback decision created: ${data.rollbackDecisionId} (${data.status})`)
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agent Decisions</h1>
        <p className="text-sm text-gray-600 mt-1">
          Records of every plan-then-act cycle. Shadow mode = LLM proposes, nothing runs. Approval
          mode = decisions wait for a human in <a href="/approvals" className="text-blue-600 underline">/approvals</a>. Autonomous = guardrails enforce.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.enabled}
                disabled={!isAdmin || savingConfig}
                onChange={(e) => saveConfig({ enabled: e.target.checked })}
              />
              Enable agent loop
            </label>

            <label className="flex items-center gap-2 text-sm">
              Mode:
              <select
                value={config.mode}
                disabled={!isAdmin || savingConfig}
                onChange={(e) => saveConfig({ mode: e.target.value })}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="shadow">shadow</option>
                <option value="approval_only">approval_only</option>
                <option value="autonomous">autonomous</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.killSwitch}
                disabled={!isAdmin || savingConfig}
                onChange={(e) => {
                  const reason = e.target.checked
                    ? prompt('Reason for kill switch?') || 'Manually triggered'
                    : ''
                  saveConfig({ killSwitch: e.target.checked, killSwitchReason: reason })
                }}
              />
              <span className={config.killSwitch ? 'text-rose-600 font-semibold' : ''}>
                Kill switch {config.killSwitch ? `(${config.killSwitchReason || 'on'})` : ''}
              </span>
            </label>

            <span className="text-sm text-gray-600">
              LLM budget: ${config.monthlyLlmSpentUsd.toFixed(2)} / ${config.monthlyLlmBudgetUsd.toFixed(2)}
            </span>

            <Button onClick={runNow} disabled={running || !config.enabled || config.killSwitch}>
              {running ? 'Running…' : 'Run now'}
            </Button>
            <Button variant="outline" onClick={snapshotNow} disabled={running || !isAdmin}>
              {running ? 'Working…' : 'Snapshot now'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-600">Filter:</span>
        <select
          value={filter.status || ''}
          onChange={(e) => setFilter('status', e.target.value)}
          className="border rounded px-2 py-1"
        >
          <option value="">all status</option>
          <option value="pending">pending</option>
          <option value="executed">executed</option>
          <option value="failed">failed</option>
          <option value="rejected">rejected</option>
          <option value="rolled_back">rolled_back</option>
          <option value="skipped">skipped</option>
        </select>
        <select
          value={filter.severity || ''}
          onChange={(e) => setFilter('severity', e.target.value)}
          className="border rounded px-2 py-1"
        >
          <option value="">all severity</option>
          <option value="info">info</option>
          <option value="opportunity">opportunity</option>
          <option value="warning">warning</option>
          <option value="alert">alert</option>
        </select>
        <input
          type="text"
          value={campaignDraft}
          onChange={(e) => setCampaignDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFilter('campaignId', campaignDraft.trim())
          }}
          placeholder="campaignId"
          className="border rounded px-2 py-1 font-mono text-xs"
        />
        <input
          type="date"
          value={filter.since || ''}
          onChange={(e) => setFilter('since', e.target.value)}
          className="border rounded px-2 py-1"
          aria-label="since"
        />
        <input
          type="date"
          value={filter.until || ''}
          onChange={(e) => setFilter('until', e.target.value)}
          className="border rounded px-2 py-1"
          aria-label="until"
        />
        {(filter.status || filter.severity || filter.campaignId || filter.since || filter.until) && (
          <Button variant="ghost" onClick={() => (window.location.href = '/decisions')}>
            Clear
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {decisions.length === 0 && (
          <p className="text-gray-500 text-sm">No decisions matching filter. Hit &ldquo;Run now&rdquo; or wait for the cron tick.</p>
        )}
        {decisions.map((d) => (
          <Card key={d.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <Badge className={SEVERITY_COLORS[d.severity] || ''}>{d.severity}</Badge>
                    <Badge className={STATUS_COLORS[d.status] || ''}>{d.status}</Badge>
                    <Badge className="bg-gray-100 text-gray-700">{d.mode}</Badge>
                    {d.outcomeClass && (
                      <Badge
                        className={
                          d.outcomeClass === 'success'
                            ? 'bg-emerald-100 text-emerald-700'
                            : d.outcomeClass === 'regression'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-gray-100 text-gray-700'
                        }
                      >
                        outcome: {d.outcomeClass}
                      </Badge>
                    )}
                    <span className="text-xs text-gray-500 ml-auto">
                      {new Date(d.createdAt).toLocaleString()} · ${d.llmCostUsd.toFixed(4)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-900">{d.rationale}</p>
                  {expanded === d.id && (
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap gap-3 text-[11px] text-gray-600 border rounded p-2 bg-gray-50">
                        <span>id: <code>{d.id}</code></span>
                        {d.triggerType && <span>trigger: {d.triggerType}</span>}
                        {d.promptVersion && <span>prompt: <code>{d.promptVersion}</code></span>}
                        {(d.llmInputTokens || d.llmOutputTokens) && (
                          <span>
                            tokens: {d.llmInputTokens ?? 0} in / {d.llmOutputTokens ?? 0} out
                          </span>
                        )}
                        {d.executedAt && (
                          <span>executed: {new Date(d.executedAt).toLocaleString()}</span>
                        )}
                        {d.outcomeDelta && (
                          <span>outcome Δ: <code>{d.outcomeDelta}</code></span>
                        )}
                      </div>
                      {d.steps.map((s) => (
                        <div
                          key={s.id}
                          className="border rounded p-2 text-xs bg-gray-50 space-y-1"
                        >
                          <div className="flex items-center gap-2">
                            <Badge>{s.toolName}</Badge>
                            <Badge className={STATUS_COLORS[s.status] || ''}>{s.status}</Badge>
                            {s.reversible && (
                              <Badge className="bg-blue-50 text-blue-700">reversible</Badge>
                            )}
                          </div>
                          <pre className="font-mono whitespace-pre-wrap break-all text-[10px]">
                            input: {s.input}
                          </pre>
                          {s.output && (
                            <pre className="font-mono whitespace-pre-wrap break-all text-[10px]">
                              output: {s.output}
                            </pre>
                          )}
                          {s.guardrailReport && (
                            <details>
                              <summary className="cursor-pointer">guardrails</summary>
                              <pre className="font-mono whitespace-pre-wrap break-all text-[10px]">
                                {s.guardrailReport}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                      {isAdmin && d.status === 'executed' && d.steps.some((s) => s.reversible) && (
                        <Button onClick={() => rollback(d.id)} variant="outline">
                          Roll back this decision
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                  >
                    {expanded === d.id ? 'Hide' : 'Inline'}
                  </Button>
                  <a
                    href={`/decisions/${d.id}`}
                    className="text-xs text-blue-600 hover:underline text-center"
                  >
                    Open page →
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
