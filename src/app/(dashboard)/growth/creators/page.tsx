'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, api } from '@/lib/utils'
import { GrowthTabs } from '../_ui'

interface Post {
  id: string
  url: string
  publishedAt: string | null
  views: number
  upliftInstalls: number
  effectiveCpi: number | null
}
interface Partnership {
  id: string
  name: string
  platform: string
  handle: string | null
  status: string
  costUsd: number
  posts: Post[]
  totalUplift: number
  totalViews: number
  blendedCpi: number | null
}

const STATUS_CLS: Record<string, string> = {
  negotiating: 'bg-mut/10 text-mut border border-line',
  agreed: 'bg-ai/10 text-ai border border-ai/25',
  published: 'bg-signal/10 text-signal border border-signal/25',
  settled: 'bg-ok/10 text-ok border border-ok/25',
  dropped: 'bg-bad/10 text-bad border border-bad/25',
}

export default function CreatorsPage() {
  const [rows, setRows] = useState<Partnership[] | null>(null)
  const [hasData, setHasData] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(api('/api/growth/creators'))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setRows(d.partnerships ?? []); setHasData(!!d.hasData) })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Growth</h1>
        <p className="text-gray-500 text-sm mt-1">KOL partnerships — natural-uplift attribution per post</p>
      </div>

      <GrowthTabs />

      {loading ? (
        <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>
      ) : !hasData ? (
        <Card><CardContent><p className="text-gray-500 text-sm py-6 text-center">No creator partnerships yet. Import your KOL台账 to track per-post uplift.</p></CardContent></Card>
      ) : (
        <div className="space-y-4">
          {rows!.map((p) => (
            <Card key={p.id}>
              <CardContent>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-xs text-dim font-mono">{p.platform}{p.handle ? ` · ${p.handle}` : ''}</span>
                      <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-mono ${STATUS_CLS[p.status] ?? STATUS_CLS.negotiating}`}>{p.status}</span>
                    </div>
                  </div>
                  <div className="flex gap-5 text-right">
                    <div><p className="text-[10px] uppercase tracking-wider text-dim">Cost</p><p className="font-mono">{formatCurrency(p.costUsd)}</p></div>
                    <div><p className="text-[10px] uppercase tracking-wider text-dim">Uplift</p><p className="font-mono">{Math.round(p.totalUplift).toLocaleString()}</p></div>
                    <div><p className="text-[10px] uppercase tracking-wider text-dim">eff. CPI</p><p className="font-mono text-signal">{p.blendedCpi === null ? '—' : formatCurrency(p.blendedCpi)}</p></div>
                  </div>
                </div>
                {p.posts.length > 0 && (
                  <table className="w-full text-xs mt-4">
                    <thead><tr className="text-dim border-b border-line"><th className="text-left font-medium pb-2">Post</th><th className="text-right font-medium pb-2">Published</th><th className="text-right font-medium pb-2">Views</th><th className="text-right font-medium pb-2">Uplift</th><th className="text-right font-medium pb-2">eff. CPI</th></tr></thead>
                    <tbody>
                      {p.posts.map((po) => (
                        <tr key={po.id} className="border-b border-line last:border-0">
                          <td className="py-2 truncate max-w-[280px]"><a href={po.url} target="_blank" rel="noreferrer" className="text-ai hover:underline font-mono">{po.url}</a></td>
                          <td className="py-2 text-right font-mono text-mut">{po.publishedAt ?? '—'}</td>
                          <td className="py-2 text-right font-mono">{po.views.toLocaleString()}</td>
                          <td className="py-2 text-right font-mono">{Math.round(po.upliftInstalls).toLocaleString()}</td>
                          <td className="py-2 text-right font-mono">{po.effectiveCpi === null ? '—' : formatCurrency(po.effectiveCpi)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
