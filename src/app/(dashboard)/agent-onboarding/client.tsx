'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

type Cfg = {
  enabled: boolean
  mode: string
  autonomousAllowed: boolean
  autonomousAllowedAt: string | null
  shadowStartedAt: string | null
  approvalOnlyStartedAt: string | null
  autonomousStartedAt: string | null
}

const MIN_SHADOW_HOURS = 7 * 24
const MIN_APPROVAL_HOURS = 14 * 24

function hoursElapsed(iso: string | null): number | null {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

export function OnboardingClient({
  role,
  config: initial,
  counts,
}: {
  role: string
  config: Cfg
  counts: { shadow: number; approval: number }
}) {
  const [cfg, setCfg] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isOwner = role === 'owner'
  const isAdmin = role === 'owner' || role === 'admin'

  const shadowHours = hoursElapsed(cfg.shadowStartedAt)
  const approvalHours = hoursElapsed(cfg.approvalOnlyStartedAt)

  async function patch(body: Record<string, unknown>, url = '/api/agent/config') {
    setErr(null)
    setBusy(true)
    try {
      const res = await fetch(api(url), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setErr(data.error || `${res.status}`)
      } else {
        setCfg({ ...cfg, ...data })
      }
    } finally {
      setBusy(false)
    }
  }

  async function setAllowlist(allowed: boolean) {
    setErr(null)
    setBusy(true)
    try {
      const res = await fetch(api('/api/agent/config/autonomous-allowlist'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed }),
      })
      const data = await res.json()
      if (!res.ok) setErr(data.error || `${res.status}`)
      else setCfg({ ...cfg, ...data })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agent onboarding</h1>
        <p className="text-sm text-gray-600 mt-1">
          New orgs progress through three stages. Each upgrade enforces a minimum dwell time
          server-side; you can downgrade at any moment.
        </p>
      </div>

      {err && (
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {err}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Stage 1 · Shadow (≥ 7 days)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            The agent runs the full plan-then-act loop but tools are no-op&apos;d. You watch
            decisions appear in <Link href="/decisions" className="text-blue-600">/decisions</Link>{' '}
            without any platform-side change.
          </p>
          <div className="flex items-center gap-3">
            {!cfg.enabled ? (
              <Button onClick={() => patch({ enabled: true })} disabled={!isAdmin || busy}>
                Enable agent (starts shadow)
              </Button>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-700">enabled</Badge>
            )}
            {cfg.shadowStartedAt && (
              <span className="text-xs text-gray-500">
                Shadow started {new Date(cfg.shadowStartedAt).toLocaleString()}
                {shadowHours != null && ` · ${shadowHours.toFixed(1)}h elapsed`}
                {' · '}{counts.shadow} shadow decisions seen
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stage 2 · Approval-only (≥ 14 days)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Every proposed step waits in <Link href="/approvals" className="text-blue-600">/approvals</Link>{' '}
            for human approval. Reject anything off; approve to actually let the tool run.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {cfg.mode === 'approval_only' ? (
              <Badge className="bg-emerald-100 text-emerald-700">currently approval_only</Badge>
            ) : (
              <Button
                onClick={() => patch({ mode: 'approval_only' })}
                disabled={
                  !isAdmin ||
                  busy ||
                  !cfg.shadowStartedAt ||
                  (shadowHours != null && shadowHours < MIN_SHADOW_HOURS)
                }
              >
                Promote to approval_only
              </Button>
            )}
            {cfg.shadowStartedAt && shadowHours != null && shadowHours < MIN_SHADOW_HOURS && (
              <span className="text-xs text-amber-700">
                {(MIN_SHADOW_HOURS - shadowHours).toFixed(1)}h remaining in shadow window
              </span>
            )}
            {cfg.approvalOnlyStartedAt && (
              <span className="text-xs text-gray-500">
                Approval started {new Date(cfg.approvalOnlyStartedAt).toLocaleString()}
                {approvalHours != null && ` · ${approvalHours.toFixed(1)}h elapsed`}
                {' · '}{counts.approval} approval decisions
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stage 3 · Autonomous (allowlist + ≥ 14 days approval-only)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Agent runs without per-step approval as long as guardrails pass. Autonomous mode is
            gated by an explicit per-org allowlist and the approval-only dwell time.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <span>Allowlist:</span>
            {cfg.autonomousAllowed ? (
              <Badge className="bg-emerald-100 text-emerald-700">allowed</Badge>
            ) : (
              <Badge className="bg-gray-100 text-gray-600">not allowed</Badge>
            )}
            {isOwner && (
              <Button
                variant="outline"
                onClick={() => setAllowlist(!cfg.autonomousAllowed)}
                disabled={busy}
              >
                {cfg.autonomousAllowed ? 'Revoke' : 'Grant'} (owner only)
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {cfg.mode === 'autonomous' ? (
              <Badge className="bg-emerald-100 text-emerald-700">currently autonomous</Badge>
            ) : (
              <Button
                onClick={() => patch({ mode: 'autonomous' })}
                disabled={
                  !isAdmin ||
                  busy ||
                  !cfg.autonomousAllowed ||
                  !cfg.approvalOnlyStartedAt ||
                  (approvalHours != null && approvalHours < MIN_APPROVAL_HOURS)
                }
              >
                Promote to autonomous
              </Button>
            )}
            {cfg.approvalOnlyStartedAt &&
              approvalHours != null &&
              approvalHours < MIN_APPROVAL_HOURS && (
                <span className="text-xs text-amber-700">
                  {(MIN_APPROVAL_HOURS - approvalHours).toFixed(1)}h remaining in approval window
                </span>
              )}
            {cfg.autonomousStartedAt && (
              <span className="text-xs text-gray-500">
                Autonomous started {new Date(cfg.autonomousStartedAt).toLocaleString()}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Downgrade</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-gray-600">
            Downgrades are instant — no dwell-time enforcement.
          </p>
          <div className="flex gap-2">
            {cfg.mode !== 'approval_only' && (
              <Button
                variant="outline"
                onClick={() => patch({ mode: 'approval_only' })}
                disabled={!isAdmin || busy}
              >
                Drop to approval_only
              </Button>
            )}
            {cfg.mode !== 'shadow' && (
              <Button
                variant="outline"
                onClick={() => patch({ mode: 'shadow' })}
                disabled={!isAdmin || busy}
              >
                Drop to shadow
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-rose-200">
        <CardHeader>
          <CardTitle className="text-rose-700">Decommission · 永久停用</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-gray-700">
            完全停用此 org 的 Agent — 关 enabled、回到 shadow mode、拒掉所有挂起审批、清除 autonomous 白名单。
            <strong className="text-rose-700"> 不会删除任何历史数据</strong>（Decision / Outcome / PromptRun / Guardrail 全部保留），方便审计 / 之后再启用。
            <br />Owner 专属。
          </p>
          {isOwner && (
            <Button
              variant="outline"
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
              onClick={async () => {
                if (
                  !confirm(
                    'Decommission the agent for this workspace?\n\n' +
                      '- enabled → false\n' +
                      '- mode → shadow\n' +
                      '- All pending approvals → rejected\n' +
                      '- Autonomous allowlist → revoked\n\n' +
                      'Historical records (decisions, outcomes, prompt runs, guardrails) are kept for audit.'
                  )
                )
                  return
                setBusy(true)
                try {
                  const res = await fetch(api('/api/agent/decommission'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirm: 'DISABLE_AGENT' }),
                  })
                  const data = await res.json()
                  if (!res.ok) {
                    setErr(data.error || `${res.status}`)
                  } else {
                    alert(
                      `Decommissioned.\nPending approvals rejected: ${data.pendingRejected}\nKept for audit: ${data.archive.decisionCount} decisions, ${data.archive.outcomeCount} outcomes, ${data.archive.promptRunCount} prompt runs.`
                    )
                    window.location.reload()
                  }
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
            >
              {busy ? 'Working…' : 'Decommission agent (owner only)'}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
