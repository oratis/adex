'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { api } from '@/lib/utils'

type Session = {
  id: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  isCurrent: boolean
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function parseUA(ua: string | null): string {
  if (!ua) return 'Unknown device'
  if (ua.includes('iPhone')) return '📱 iPhone'
  if (ua.includes('iPad')) return '📱 iPad'
  if (ua.includes('Android')) return '📱 Android'
  if (ua.includes('Macintosh')) return '💻 Mac'
  if (ua.includes('Windows')) return '💻 Windows'
  if (ua.includes('Linux')) return '💻 Linux'
  return '💻 Desktop'
}

function parseBrowser(ua: string | null): string {
  if (!ua) return ''
  if (ua.includes('Edg/')) return 'Edge'
  if (ua.includes('Chrome/') && !ua.includes('Chromium')) return 'Chrome'
  if (ua.includes('Firefox/')) return 'Firefox'
  if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari'
  return 'Unknown browser'
}

export function SessionsPanel() {
  const { toast } = useToast()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(api('/api/auth/sessions'))
      const data = await res.json()
      if (Array.isArray(data)) setSessions(data)
    } catch {
      toast({ variant: 'error', title: 'Failed to load sessions' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  async function revoke(id: string) {
    if (!confirm('Revoke this session?')) return
    setRevoking(id)
    try {
      const res = await fetch(api(`/api/auth/sessions/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast({ variant: 'success', title: 'Session revoked' })
      load()
    } catch {
      toast({ variant: 'error', title: 'Revoke failed' })
    } finally {
      setRevoking(null)
    }
  }

  async function revokeAllOthers() {
    const others = sessions.filter((s) => !s.isCurrent).length
    if (others === 0) return
    if (!confirm(`Sign out of ${others} other session${others === 1 ? '' : 's'}?`)) return
    try {
      const res = await fetch(api('/api/auth/sessions'), { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast({ variant: 'success', title: 'All other sessions signed out' })
      load()
    } catch {
      toast({ variant: 'error', title: 'Sign out failed' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Active Sessions</CardTitle>
          {sessions.filter((s) => !s.isCurrent).length > 0 && (
            <Button size="sm" variant="danger" onClick={revokeAllOthers}>
              Sign out all other sessions
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No active sessions.</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between border rounded-lg p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{parseUA(s.userAgent)}</span>
                    <span className="text-xs text-gray-500">{parseBrowser(s.userAgent)}</span>
                    {s.isCurrent && <Badge variant="success">This device</Badge>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {s.ipAddress || 'unknown IP'} · last seen {timeAgo(s.lastSeenAt)} ·
                    signed in {timeAgo(s.createdAt)}
                  </div>
                </div>
                {!s.isCurrent && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => revoke(s.id)}
                    disabled={revoking === s.id}
                  >
                    {revoking === s.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
