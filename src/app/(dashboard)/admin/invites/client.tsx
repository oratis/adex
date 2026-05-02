'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { api } from '@/lib/utils'

type Code = {
  id: string
  code: string
  note: string | null
  createdBy: string
  createdAt: string
  expiresAt: string | null
  usedAt: string | null
  usedBy: string | null
  revokedAt: string | null
}

function statusOf(c: Code): { label: string; cls: string } {
  if (c.revokedAt) return { label: 'revoked', cls: 'bg-gray-200 text-gray-600' }
  if (c.usedAt) return { label: 'used', cls: 'bg-emerald-100 text-emerald-700' }
  if (c.expiresAt && new Date(c.expiresAt) < new Date())
    return { label: 'expired', cls: 'bg-amber-100 text-amber-700' }
  return { label: 'unused', cls: 'bg-blue-100 text-blue-700' }
}

export function InvitesClient({
  codes: initial,
  filterStatus,
}: {
  codes: Code[]
  filterStatus: string
}) {
  const confirm = useConfirm()
  const [codes, setCodes] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [draft, setDraft] = useState({ note: '', batchLabel: '', expiresInDays: '', count: '1' })

  function setStatus(s: string) {
    const url = new URL(window.location.href)
    if (s) url.searchParams.set('status', s)
    else url.searchParams.delete('status')
    window.location.href = url.toString()
  }

  async function generate() {
    setBusy('__generate__')
    try {
      const body: Record<string, unknown> = {}
      if (draft.note.trim()) body.note = draft.note.trim()
      if (draft.batchLabel.trim()) body.batchLabel = draft.batchLabel.trim()
      const exp = Number(draft.expiresInDays)
      if (Number.isFinite(exp) && exp > 0) body.expiresInDays = exp
      const count = Number(draft.count)
      if (Number.isFinite(count) && count > 1) body.count = Math.min(count, 50)
      const res = await fetch(api('/api/admin/invite-codes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
        return
      }
      setCodes([...(data.created as Code[]), ...codes])
      setShowNew(false)
      setDraft({ note: '', batchLabel: '', expiresInDays: '', count: '1' })
    } finally {
      setBusy(null)
    }
  }

  async function revoke(id: string) {
    if (
      !(await confirm({
        title: 'Revoke invite code',
        message: 'Revoke this invite code? Anyone holding it can no longer register.',
        confirmLabel: 'Revoke',
        variant: 'danger',
      }))
    )
      return
    setBusy(id)
    try {
      const res = await fetch(api(`/api/admin/invite-codes/${id}`), { method: 'DELETE' })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        setCodes(
          codes.map((c) => (c.id === id ? { ...c, revokedAt: new Date().toISOString() } : c))
        )
      }
    } finally {
      setBusy(null)
    }
  }

  async function copyShareLink(c: Code) {
    const url = `${window.location.origin}/register?code=${encodeURIComponent(c.code)}`
    try {
      await navigator.clipboard.writeText(url)
      alert(`Copied: ${url}`)
    } catch {
      prompt('Copy this URL:', url)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Invite codes</h1>
          <p className="text-sm text-gray-600 mt-1">
            Adex is invite-only. Generate codes here and share them with new users. Each code is
            single-use; once redeemed, it can&apos;t be used again. Revoke any code at any time —
            unused holders are immediately blocked.
          </p>
        </div>
        <Button onClick={() => setShowNew(!showNew)}>
          {showNew ? 'Cancel' : '+ New code'}
        </Button>
      </div>

      {showNew && (
        <Card>
          <CardHeader>
            <CardTitle>Generate invite codes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                Count
                <Input
                  value={draft.count}
                  onChange={(e) => setDraft({ ...draft, count: e.target.value })}
                  type="number"
                  min={1}
                  max={50}
                  className="mt-1"
                />
              </label>
              <label className="block">
                Expires in (days, blank = never)
                <Input
                  value={draft.expiresInDays}
                  onChange={(e) => setDraft({ ...draft, expiresInDays: e.target.value })}
                  type="number"
                  min={1}
                  className="mt-1"
                />
              </label>
              <label className="block sm:col-span-3">
                Batch label · 批次名称 (optional, e.g. &quot;spring-2026 partner pilot&quot;)
                <Input
                  value={draft.batchLabel}
                  onChange={(e) => setDraft({ ...draft, batchLabel: e.target.value })}
                  className="mt-1"
                />
                <span className="text-xs text-gray-500">
                  All codes generated in this submission share this label, so you can group + filter later.
                </span>
              </label>
              <label className="block sm:col-span-3">
                Note (optional, per-code memo)
                <Input
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  className="mt-1"
                />
              </label>
            </div>
            <Button onClick={generate} disabled={busy === '__generate__'}>
              {busy === '__generate__' ? 'Generating…' : 'Generate'}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">Filter:</span>
        {['all', 'unused', 'used', 'expired', 'revoked'].map((s) => (
          <Button
            key={s}
            variant={filterStatus === s ? 'primary' : 'ghost'}
            onClick={() => setStatus(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      {codes.length === 0 && (
        <p className="text-sm text-gray-500">No invite codes match this filter.</p>
      )}

      <div className="space-y-2">
        {codes.map((c) => {
          const s = statusOf(c)
          return (
            <Card key={c.id}>
              <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <code className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">{c.code}</code>
                  <Badge className={s.cls}>{s.label}</Badge>
                  {c.note && <span className="text-xs text-gray-600 italic">{c.note}</span>}
                </div>
                <div className="text-xs text-gray-500 sm:ml-auto flex flex-col sm:items-end">
                  <span>created {new Date(c.createdAt).toLocaleDateString()} by {c.createdBy}</span>
                  {c.expiresAt && (
                    <span>expires {new Date(c.expiresAt).toLocaleDateString()}</span>
                  )}
                  {c.usedBy && (
                    <span>used by {c.usedBy} {c.usedAt && `· ${new Date(c.usedAt).toLocaleDateString()}`}</span>
                  )}
                </div>
                {!c.revokedAt && !c.usedAt && (
                  <div className="flex gap-2 sm:flex-none">
                    <Button size="sm" variant="ghost" onClick={() => copyShareLink(c)}>
                      Copy link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => revoke(c.id)}
                      disabled={busy === c.id}
                    >
                      Revoke
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
