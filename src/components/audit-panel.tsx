'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { api } from '@/lib/utils'

type AuditEvent = {
  id: string
  userId: string | null
  userName: string
  action: string
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: string
}

const ACTION_ICONS: Record<string, string> = {
  'campaign.create': '🎯',
  'campaign.update': '✏️',
  'campaign.delete': '🗑️',
  'campaign.launch': '🚀',
  'campaign.pause': '⏸',
  'campaign.resume': '▶',
  'member.invite': '✉️',
  'member.invite_revoke': '🚫',
  'member.invite_accept': '👋',
  'member.role_change': '🏷️',
  'member.remove': '🗑️',
  'advisor.apply': '🤖',
  'cron.daily': '⏰',
  'platform.connect': '🔗',
  'platform.disconnect': '🔌',
}

const ACTION_VARIANT: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'default'> = {
  'campaign.delete': 'danger',
  'member.remove': 'danger',
  'member.invite_revoke': 'danger',
  'platform.disconnect': 'danger',
  'campaign.launch': 'success',
  'campaign.pause': 'warning',
  'campaign.resume': 'success',
  'advisor.apply': 'info',
  'member.invite': 'info',
  'member.role_change': 'warning',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function AuditPanel() {
  const { toast } = useToast()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load(before?: string) {
    setLoading(true)
    try {
      const url = before
        ? api(`/api/orgs/audit?before=${encodeURIComponent(before)}`)
        : api('/api/orgs/audit')
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) {
        toast({ variant: 'error', title: 'Failed to load audit log', description: data.error })
        return
      }
      if (Array.isArray(data)) {
        if (before) setEvents((prev) => [...prev, ...data])
        else setEvents(data)
        setHasMore(data.length >= 50)
      }
    } catch {
      toast({ variant: 'error', title: 'Failed to load audit log' })
    } finally {
      setLoading(false)
    }
  }

  function loadMore() {
    const last = events[events.length - 1]
    if (last) load(last.createdAt)
  }

  function describeMetadata(action: string, md: Record<string, unknown> | null): string {
    if (!md) return ''
    if (action.startsWith('campaign') && md.name) return String(md.name)
    if (action === 'member.invite' && md.email) return `${md.email} as ${md.role}`
    if (action === 'member.role_change' && md.fromRole && md.toRole) {
      return `${md.fromRole} → ${md.toRole}`
    }
    if (action === 'member.remove') return md.self ? '(left workspace)' : ''
    if (action === 'advisor.apply' && md.applied) return String(md.applied).replace('_', ' ')
    return ''
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Log</CardTitle>
        <p className="text-xs text-gray-500 mt-1">
          Every consequential action in this workspace. Visible to admins and owners.
        </p>
      </CardHeader>
      <CardContent>
        {loading && events.length === 0 ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No audit events yet.</p>
        ) : (
          <div className="space-y-2">
            {events.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 text-sm py-2 border-b last:border-0"
              >
                <span className="text-lg w-6 text-center">
                  {ACTION_ICONS[e.action] || '•'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{e.userName}</span>
                    <Badge variant={ACTION_VARIANT[e.action] || 'default'}>{e.action}</Badge>
                    {describeMetadata(e.action, e.metadata) && (
                      <span className="text-gray-600 truncate">
                        {describeMetadata(e.action, e.metadata)}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap" title={e.createdAt}>
                  {timeAgo(e.createdAt)}
                </span>
              </div>
            ))}
            {hasMore && (
              <div className="pt-3 text-center">
                <Button size="sm" variant="outline" onClick={loadMore} disabled={loading}>
                  {loading ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
