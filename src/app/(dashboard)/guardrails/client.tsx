'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'
import { GUARDRAIL_SCHEMAS, getSchema, type GuardrailSchema } from '@/lib/agent/guardrail-schemas'
import { localHourToUtc, utcHourToLocal } from '@/lib/time'
import { EmptyState } from '@/components/ui/empty-state'

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
  userTimezone = 'UTC',
}: {
  role: string
  initial: Guardrail[]
  userTimezone?: string
}) {
  const [rows, setRows] = useState(initial)
  const [showNew, setShowNew] = useState(false)
  const [draftRule, setDraftRule] = useState<string>(GUARDRAIL_SCHEMAS[0].rule)
  const [draftScope, setDraftScope] = useState<{ scope: string; scopeId: string }>({
    scope: 'global',
    scopeId: '',
  })
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const isAdmin = role === 'owner' || role === 'admin'

  const schema = getSchema(draftRule)

  function setDefaultsFor(rule: string) {
    const s = getSchema(rule)
    if (!s) return
    const out: Record<string, unknown> = {}
    for (const f of s.fields) out[f.name] = f.default
    setDraftConfig(out)
  }

  function selectRule(rule: string) {
    setDraftRule(rule)
    setDefaultsFor(rule)
  }

  async function create() {
    if (!schema) return
    // Validate required fields
    for (const f of schema.fields) {
      if (f.required && (draftConfig[f.name] === undefined || draftConfig[f.name] === null)) {
        alert(`${f.label.en} is required`)
        return
      }
    }
    // Special: agent_active_hours stores UTC internally
    const configToSave = { ...draftConfig }
    if (draftRule === 'agent_active_hours') {
      const sl = Number(configToSave.startHourLocal)
      const el = Number(configToSave.endHourLocal)
      if (Number.isFinite(sl)) configToSave.startHourUtc = localHourToUtc(sl, userTimezone)
      if (Number.isFinite(el)) configToSave.endHourUtc = localHourToUtc(el, userTimezone)
    }
    setBusy(true)
    try {
      const res = await fetch(api('/api/agent/guardrails'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: draftScope.scope,
          scopeId: draftScope.scope === 'global' ? null : draftScope.scopeId,
          rule: draftRule,
          config: configToSave,
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
        setDraftConfig({})
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
          <h1 className="text-2xl font-bold">Guardrails · 安全规则</h1>
          <p className="text-sm text-gray-600 mt-1">
            硬性规则，Agent 不能越线。12 条内建规则始终生效；下方可加自定义规则覆盖默认值或加新约束。
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              if (!showNew) setDefaultsFor(draftRule)
              setShowNew(!showNew)
            }}
          >
            {showNew ? 'Cancel' : '+ New guardrail'}
          </Button>
        )}
      </div>

      {showNew && isAdmin && schema && (
        <Card>
          <CardHeader>
            <CardTitle>New guardrail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="block">
                <span className="text-gray-700">Scope · 作用范围</span>
                <select
                  value={draftScope.scope}
                  onChange={(e) => setDraftScope({ ...draftScope, scope: e.target.value })}
                  className="block w-full border rounded px-2 py-1.5 mt-1"
                >
                  <option value="global">global · 全局</option>
                  <option value="platform">platform · 单平台</option>
                  <option value="campaign">campaign · 单广告系列</option>
                </select>
              </label>
              {draftScope.scope !== 'global' && (
                <label className="block">
                  <span className="text-gray-700">Scope ID</span>
                  <input
                    value={draftScope.scopeId}
                    onChange={(e) => setDraftScope({ ...draftScope, scopeId: e.target.value })}
                    className="block w-full border rounded px-2 py-1.5 mt-1"
                    placeholder={
                      draftScope.scope === 'platform' ? 'google | meta | tiktok' : 'campaign cuid…'
                    }
                  />
                </label>
              )}
              <label className="col-span-2 block">
                <span className="text-gray-700">Rule · 规则</span>
                <select
                  value={draftRule}
                  onChange={(e) => selectRule(e.target.value)}
                  className="block w-full border rounded px-2 py-1.5 mt-1"
                >
                  {GUARDRAIL_SCHEMAS.map((s) => (
                    <option key={s.rule} value={s.rule}>
                      {s.label.zh} · {s.label.en}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-gray-500 block mt-1">{schema.description.zh}</span>
                <span className="text-[10px] text-gray-400 block">{schema.description.en}</span>
              </label>
            </div>

            {schema.fields.length === 0 ? (
              <p className="text-xs text-gray-600 italic">这条规则不需要任何参数 — 创建即生效。</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                {schema.fields.map((f) => (
                  <FieldInput
                    key={f.name}
                    field={f}
                    value={draftConfig[f.name]}
                    timezone={userTimezone}
                    onChange={(v) => setDraftConfig({ ...draftConfig, [f.name]: v })}
                  />
                ))}
              </div>
            )}

            <Button onClick={create} disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rows.length === 0 ? (
          <EmptyState
            emoji="🚧"
            title="还没有自定义规则"
            description={
              <>
                12 条<strong>内建规则</strong>始终生效（高风险审批、cooldown、最大日预算等）。如果想加更严的边界，点上方 &ldquo;+ New guardrail&rdquo;。
              </>
            }
          />
        ) : (
          rows.map((g) => {
            const s = getSchema(g.rule)
            const cfg = parseConfig(g.config)
            return (
              <Card key={g.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge>{s?.label.zh || g.rule}</Badge>
                        <Badge className="bg-gray-100 text-gray-700">
                          {g.scope}
                          {g.scopeId ? `:${g.scopeId.slice(0, 8)}` : ''}
                        </Badge>
                        {!g.isActive && (
                          <Badge className="bg-gray-200 text-gray-600">disabled</Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-700 mb-1">{s?.description.zh || ''}</div>
                      {s && s.fields.length > 0 && (
                        <div className="text-xs text-gray-600 space-y-0.5">
                          {s.fields.map((f) => (
                            <div key={f.name}>
                              <span className="text-gray-500">{f.label.zh}：</span>
                              <span className="font-mono">
                                {renderConfigValue(f, cfg[f.name], userTimezone)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
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
            )
          })
        )}
      </div>
    </div>
  )
}

function FieldInput({
  field,
  value,
  timezone,
  onChange,
}: {
  field: GuardrailSchema['fields'][number]
  value: unknown
  timezone: string
  onChange: (v: unknown) => void
}) {
  const t = field.type
  if (t.kind === 'strings') {
    const arr = Array.isArray(value) ? (value as string[]) : []
    return (
      <label className="block">
        <span className="text-gray-700">{field.label.zh} · {field.label.en}</span>
        <input
          value={arr.join(', ')}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            )
          }
          className="block w-full border rounded px-2 py-1.5 mt-1"
        />
        <span className="text-xs text-gray-500">{field.hint.zh || field.hint.en}</span>
      </label>
    )
  }
  if (t.kind === 'string') {
    return (
      <label className="block">
        <span className="text-gray-700">{field.label.zh}</span>
        <input
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full border rounded px-2 py-1.5 mt-1"
        />
        <span className="text-xs text-gray-500">{field.hint.zh || field.hint.en}</span>
      </label>
    )
  }
  // number / integer / percent / localHour all share number input
  const numericValue = value === undefined || value === null ? '' : String(value)
  const min = 'min' in t ? t.min : undefined
  const max = 'max' in t ? t.max : undefined
  const step = t.kind === 'integer' || t.kind === 'localHour' ? 1 : 'step' in t ? t.step : undefined
  const suffix =
    t.kind === 'percent' ? '%' : t.kind === 'localHour' ? `:00 (${timezone})` : ''
  return (
    <label className="block">
      <span className="text-gray-700">
        {field.label.zh} · {field.label.en}
      </span>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="number"
          value={numericValue}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = e.target.value === '' ? undefined : Number(e.target.value)
            onChange(v)
          }}
          className="block w-full border rounded px-2 py-1.5"
        />
        {suffix && <span className="text-xs text-gray-500 whitespace-nowrap">{suffix}</span>}
      </div>
      {field.hint.zh && <span className="text-xs text-gray-500">{field.hint.zh}</span>}
    </label>
  )
}

function parseConfig(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function renderConfigValue(
  field: GuardrailSchema['fields'][number],
  value: unknown,
  timezone: string
): string {
  if (value === undefined || value === null) return '(未设置)'
  if (field.type.kind === 'localHour' && typeof value === 'number') {
    // Stored in UTC; show as local hour for clarity
    return `${utcHourToLocal(value, timezone)}:00 (${timezone})`
  }
  if (field.type.kind === 'percent') return `${value}%`
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}
