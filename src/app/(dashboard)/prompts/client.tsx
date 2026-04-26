'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

type PromptVersion = {
  id: string
  name: string
  version: number
  model: string
  isDefault: boolean
  template: string
  createdAt: string
}

export function PromptsClient({
  role,
  versions,
}: {
  role: string
  versions: PromptVersion[]
}) {
  const [list, setList] = useState(versions)
  const [showNew, setShowNew] = useState(false)
  const [draft, setDraft] = useState({
    name: 'agent.plan',
    model: 'claude-sonnet-4-5',
    template: '',
    isDefault: false,
  })
  const [busy, setBusy] = useState(false)
  const [backtestFor, setBacktestFor] = useState<string | null>(null)
  const [backtestResult, setBacktestResult] = useState<unknown>(null)
  const isAdmin = role === 'owner' || role === 'admin'

  const grouped = useMemo(() => {
    const map = new Map<string, PromptVersion[]>()
    for (const v of list) {
      const arr = map.get(v.name) || []
      arr.push(v)
      map.set(v.name, arr)
    }
    return Array.from(map.entries())
  }, [list])

  async function create() {
    if (!draft.template.trim()) {
      alert('template required')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(api('/api/agent/prompts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        setList([
          {
            id: data.id,
            name: data.name,
            version: data.version,
            model: data.model,
            isDefault: data.isDefault,
            template: data.template,
            createdAt: data.createdAt,
          },
          ...list,
        ])
        setShowNew(false)
        setDraft({ ...draft, template: '' })
      }
    } finally {
      setBusy(false)
    }
  }

  async function promote(id: string) {
    if (!confirm('Promote this version to default for its prompt name?')) return
    setBusy(true)
    try {
      const res = await fetch(api(`/api/agent/prompts/${id}/promote`), { method: 'POST' })
      const data = await res.json()
      if (data.error) alert(data.error)
      else {
        setList(
          list.map((v) =>
            v.name === data.name ? { ...v, isDefault: v.id === id } : v
          )
        )
      }
    } finally {
      setBusy(false)
    }
  }

  async function backtest(id: string) {
    setBacktestFor(id)
    setBacktestResult(null)
    setBusy(true)
    try {
      const res = await fetch(api('/api/agent/backtest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptVersionId: id, sinceHours: 168, limit: 20 }),
      })
      const data = await res.json()
      setBacktestResult(data)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Prompt versions</h1>
          <p className="text-sm text-gray-600 mt-1">
            DB-backed prompt registry. Mark a version as default to make the agent loop pick it up
            on the next cron tick. Backtest a candidate against the last 7d of perceive snapshots
            before promoting.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowNew(!showNew)}>
            {showNew ? 'Cancel' : 'New version'}
          </Button>
        )}
      </div>

      {showNew && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>New prompt version</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <label className="block">
              Name
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="block w-full border rounded px-2 py-1 mt-1"
                placeholder="agent.plan"
              />
            </label>
            <label className="block">
              Model
              <input
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                className="block w-full border rounded px-2 py-1 mt-1"
                placeholder="claude-sonnet-4-5"
              />
            </label>
            <label className="block">
              Template
              <textarea
                value={draft.template}
                onChange={(e) => setDraft({ ...draft, template: e.target.value })}
                className="block w-full border rounded px-2 py-1 mt-1 font-mono text-xs"
                rows={12}
                spellCheck={false}
                placeholder="Use {{TOOL_CATALOG_JSON}}, {{RECENT_DECISIONS_JSON}}, {{GUARDRAIL_HINTS}}, {{CAMPAIGNS_JSON}} placeholders."
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
              />
              Promote to default
            </label>
            <Button onClick={create} disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {grouped.map(([name, versions]) => (
          <Card key={name}>
            <CardHeader>
              <CardTitle className="font-mono text-base">{name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="border rounded p-3 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Badge>v{v.version}</Badge>
                      {v.isDefault && (
                        <Badge className="bg-emerald-100 text-emerald-700">default</Badge>
                      )}
                      <span className="text-xs text-gray-500">{v.model}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(v.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1">
                        {!v.isDefault && (
                          <Button variant="ghost" onClick={() => promote(v.id)} disabled={busy}>
                            Promote
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => backtest(v.id)} disabled={busy}>
                          Backtest 7d
                        </Button>
                      </div>
                    )}
                  </div>
                  <details>
                    <summary className="cursor-pointer text-xs text-gray-600">Show template</summary>
                    <pre className="font-mono text-[10px] bg-gray-50 p-2 rounded whitespace-pre-wrap break-all mt-2">
                      {v.template}
                    </pre>
                  </details>
                  {backtestFor === v.id && backtestResult != null ? (
                    <div className="border rounded p-2 bg-blue-50 text-xs">
                      <pre className="font-mono whitespace-pre-wrap break-all">
                        {JSON.stringify(backtestResult, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
        {grouped.length === 0 && (
          <p className="text-sm text-gray-500">
            No DB-backed prompt versions yet. The deployed agent is using the disk fallback at
            <code> src/lib/agent/prompts/plan.v1.md</code>. Create a new version above to start
            iterating.
          </p>
        )}
      </div>
    </div>
  )
}
