'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'

type Creative = {
  id: string
  name: string
  type: string
  source: string
  prompt: string | null
  fileUrl: string | null
  reviewStatus: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
}

export function ReviewClient({
  role,
  creatives,
  filterStatus,
}: {
  role: string
  creatives: Creative[]
  filterStatus: string
}) {
  const [list, setList] = useState(creatives)
  const [busy, setBusy] = useState<string | null>(null)
  const isAdmin = role === 'owner' || role === 'admin'

  function setStatus(s: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('status', s)
    window.location.href = url.toString()
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(id)
    let notes: string | null = null
    if (action === 'reject') notes = prompt('Reason for rejection (optional):') || ''
    try {
      const res = await fetch(api('/api/creatives/review'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creativeId: id, action, notes }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        setList(list.filter((c) => c.id !== id))
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Creative review</h1>
        <p className="text-sm text-gray-600 mt-1">
          Agent-generated creatives sit here in <code>pending</code> until an admin approves or
          rejects. Only approved creatives can be pushed to a platform via{' '}
          <code>push_creative_to_platform</code>.
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-600">Filter:</span>
        {['pending', 'approved', 'rejected'].map((s) => (
          <Button
            key={s}
            variant={filterStatus === s ? 'primary' : 'ghost'}
            onClick={() => setStatus(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      {list.length === 0 && (
        <EmptyState
          emoji="🖼️"
          title={`Nothing in ${filterStatus} · 暂无 ${filterStatus} 创意`}
          description="Agent-generated creatives land here. Toggle filters above to see approved / rejected ones."
        />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {list.map((c) => (
          <Card key={c.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={STATUS_COLORS[c.reviewStatus] || ''}>{c.reviewStatus}</Badge>
                <Badge>{c.type}</Badge>
                <Badge className="bg-gray-100 text-gray-700">{c.source}</Badge>
                <span className="text-xs text-gray-500 ml-auto">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm font-medium">{c.name}</p>
              {c.prompt && (
                <p className="text-xs text-gray-600 italic">{c.prompt.slice(0, 240)}</p>
              )}
              {c.fileUrl && (
                <a
                  href={c.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Open asset
                </a>
              )}
              {c.reviewNotes && (
                <p className="text-xs text-gray-700 border-l-2 border-gray-300 pl-2">
                  Reviewer notes: {c.reviewNotes}
                </p>
              )}
              {isAdmin && c.reviewStatus === 'pending' && (
                <div className="flex gap-2 pt-2">
                  <Button onClick={() => decide(c.id, 'approve')} disabled={busy === c.id}>
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => decide(c.id, 'reject')}
                    disabled={busy === c.id}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
