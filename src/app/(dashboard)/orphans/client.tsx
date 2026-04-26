'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

type Orphan = {
  id: string
  platform: string
  accountId: string
  platformEntityId: string
  metadata: string | null
  lastSyncedAt: string | null
}

export function OrphansClient({
  role,
  orphans,
}: {
  role: string
  orphans: Orphan[]
}) {
  const [list, setList] = useState(orphans)
  const [busy, setBusy] = useState<string | null>(null)
  const isAdmin = role === 'owner' || role === 'admin'

  async function act(id: string, action: 'import' | 'ignore') {
    setBusy(id)
    try {
      const res = await fetch(api('/api/agent/orphans'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformLinkId: id, action }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        setList(list.filter((o) => o.id !== id))
      }
    } finally {
      setBusy(null)
    }
  }

  function discoveredName(o: Orphan): string | null {
    if (!o.metadata) return null
    try {
      const m = JSON.parse(o.metadata) as { discoveredName?: string }
      return typeof m.discoveredName === 'string' ? m.discoveredName : null
    } catch {
      return null
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Orphan campaigns</h1>
        <p className="text-sm text-gray-600 mt-1">
          Campaigns discovered on a platform that have no local Campaign row. Import to start
          managing them in Adex (the agent will then propose changes for them); ignore to mark
          permanently out-of-scope. Snapshot capture re-discovers ignored ones only if their
          status changes.
        </p>
      </div>

      {list.length === 0 && (
        <p className="text-sm text-gray-500">
          No orphans. Either nothing is mismatched, or the snapshot cron hasn&apos;t run yet — go
          to <Link href="/decisions" className="text-blue-600 underline">/decisions</Link> and hit
          &ldquo;Snapshot now&rdquo;.
        </p>
      )}

      <div className="grid gap-2">
        {list.map((o) => (
          <Card key={o.id}>
            <CardContent className="p-3 flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge>{o.platform}</Badge>
                  <span className="text-xs text-gray-500">account {o.accountId}</span>
                  {o.lastSyncedAt && (
                    <span className="text-xs text-gray-400 ml-auto">
                      last synced {new Date(o.lastSyncedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="text-sm font-mono mt-1">
                  {discoveredName(o) ?? '(unnamed)'}{' '}
                  <span className="text-gray-400">· id {o.platformEntityId}</span>
                </p>
              </div>
              {isAdmin && (
                <div className="flex gap-1">
                  <Button onClick={() => act(o.id, 'import')} disabled={busy === o.id}>
                    {busy === o.id ? '…' : 'Import'}
                  </Button>
                  <Button variant="outline" onClick={() => act(o.id, 'ignore')} disabled={busy === o.id}>
                    Ignore
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
