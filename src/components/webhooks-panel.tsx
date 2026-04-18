'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { api } from '@/lib/utils'

type Webhook = {
  id: string
  url: string
  secretPreview: string
  events: string[]
  isActive: boolean
  lastDeliveredAt: string | null
  lastStatusCode: number | null
  lastError: string | null
  failureCount: number
  createdAt: string
}

const EVENTS = [
  'campaign.launched',
  'campaign.paused',
  'campaign.resumed',
  'campaign.deleted',
  'budget.exceeded',
  'advisor.alert',
  'member.invited',
  'member.joined',
  'report.synced',
]

export function WebhooksPanel() {
  const { toast } = useToast()
  const [hooks, setHooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set(['campaign.launched']))
  const [creating, setCreating] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(api('/api/orgs/webhooks'))
      const data = await res.json()
      if (Array.isArray(data)) setHooks(data)
    } catch {
      toast({ variant: 'error', title: 'Failed to load webhooks' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  function toggleEvent(e: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(e)) next.delete(e)
      else next.add(e)
      return next
    })
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!url || selected.size === 0) return
    setCreating(true)
    setNewSecret(null)
    try {
      const res = await fetch(api('/api/orgs/webhooks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, events: Array.from(selected) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Create failed')
      setNewSecret(data.secret)
      toast({ variant: 'success', title: 'Webhook created' })
      setUrl('')
      load()
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Create failed',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(h: Webhook) {
    try {
      const res = await fetch(api(`/api/orgs/webhooks/${h.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !h.isActive }),
      })
      if (!res.ok) throw new Error()
      load()
    } catch {
      toast({ variant: 'error', title: 'Toggle failed' })
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this webhook?')) return
    try {
      const res = await fetch(api(`/api/orgs/webhooks/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast({ variant: 'success', title: 'Webhook deleted' })
      load()
    } catch {
      toast({ variant: 'error', title: 'Delete failed' })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create webhook</CardTitle>
          <p className="text-xs text-gray-500 mt-1">
            Adex will POST to your URL when the selected events happen. Requests are
            signed with an HMAC-SHA256 signature in the <code>X-Adex-Signature</code> header.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Target URL</label>
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/…  or  https://your-api.example.com/adex-webhook"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Events</label>
              <div className="flex flex-wrap gap-2">
                {EVENTS.map((e) => (
                  <button
                    type="button"
                    key={e}
                    onClick={() => toggleEvent(e)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selected.has(e)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <Button type="submit" disabled={creating || !url || selected.size === 0}>
              {creating ? 'Creating…' : 'Create webhook'}
            </Button>
          </form>
          {newSecret && (
            <div className="mt-4 bg-amber-50 border border-amber-200 text-amber-900 text-xs p-3 rounded-lg">
              <p className="font-semibold mb-1">⚠ Save this secret — you won&apos;t see it again</p>
              <code className="break-all">{newSecret}</code>
              <p className="mt-2">Use it to verify signatures: <code>HMAC-SHA256(secret, rawBody)</code></p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhooks ({hooks.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : hooks.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No webhooks yet.</p>
          ) : (
            <div className="space-y-3">
              {hooks.map((h) => (
                <div key={h.id} className="border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <code className="text-sm font-medium break-all">{h.url}</code>
                        {h.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge>Paused</Badge>
                        )}
                        {h.failureCount > 0 && (
                          <Badge variant="danger">{h.failureCount} failures</Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 flex flex-wrap gap-1 mt-1">
                        {h.events.map((e) => (
                          <span key={e} className="bg-gray-100 px-1.5 py-0.5 rounded">
                            {e}
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        Secret: <code>{h.secretPreview}</code> ·{' '}
                        {h.lastDeliveredAt
                          ? `last delivery ${new Date(h.lastDeliveredAt).toLocaleString()} → ${
                              h.lastStatusCode ?? 'error'
                            }`
                          : 'never delivered'}
                        {h.lastError && (
                          <span className="text-red-600"> · {h.lastError}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button size="sm" variant="outline" onClick={() => toggleActive(h)}>
                        {h.isActive ? 'Pause' : 'Resume'}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => remove(h.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
