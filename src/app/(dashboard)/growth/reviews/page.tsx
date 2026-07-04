'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn, api } from '@/lib/utils'
import { GrowthTabs } from '../_ui'

interface Review {
  id: string
  source: string
  country: string | null
  rating: number | null
  title: string | null
  body: string | null
  reviewedAt: string
  sentiment: string | null
  topics: string[]
  priority: string | null
}

const SENT_CLS: Record<string, string> = {
  positive: 'bg-ok/10 text-ok border border-ok/25',
  neutral: 'bg-mut/10 text-mut border border-line',
  negative: 'bg-bad/10 text-bad border border-bad/25',
  mixed: 'bg-warn/10 text-warn border border-warn/25',
}
const PRIO_CLS: Record<string, string> = {
  P0: 'bg-bad/10 text-bad border border-bad/25',
  P1: 'bg-warn/10 text-warn border border-warn/25',
  P2: 'bg-mut/10 text-mut border border-line',
  P3: 'bg-mut/10 text-dim border border-line',
}
const chip = 'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-mono'

const SENTIMENTS = ['', 'negative', 'neutral', 'positive', 'mixed']
const PRIORITIES = ['', 'P0', 'P1', 'P2', 'P3']

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const [hasData, setHasData] = useState(false)
  const [counts, setCounts] = useState({ p0: 0, negative: 0 })
  const [loading, setLoading] = useState(true)
  const [sentiment, setSentiment] = useState('')
  const [priority, setPriority] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const qs = new URLSearchParams()
      if (sentiment) qs.set('sentiment', sentiment)
      if (priority) qs.set('priority', priority)
      try {
        const res = await fetch(api(`/api/growth/reviews${qs.toString() ? `?${qs}` : ''}`))
        if (!res.ok) throw new Error()
        const d = await res.json()
        if (cancelled) return
        setReviews(d.reviews ?? [])
        setHasData(!!d.hasData)
        setCounts({ p0: d.p0 ?? 0, negative: d.negative ?? 0 })
      } catch {
        if (!cancelled) setReviews([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [sentiment, priority])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Growth</h1>
          <p className="text-gray-500 text-sm mt-1">App Store reviews — sentiment &amp; topic classification</p>
        </div>
        <div className="flex gap-2 text-xs font-mono">
          <span className={cn(chip, PRIO_CLS.P0)}>P0 · {counts.p0}</span>
          <span className={cn(chip, SENT_CLS.negative)}>neg · {counts.negative}</span>
        </div>
      </div>

      <GrowthTabs />

      <div className="flex gap-2 flex-wrap text-xs">
        {SENTIMENTS.map((s) => (
          <button key={s || 'all'} onClick={() => setSentiment(s)} className={cn('px-2.5 py-1 rounded font-mono border', sentiment === s ? 'border-signal text-signal' : 'border-line text-mut hover:text-gray-300')}>{s || 'all sentiment'}</button>
        ))}
        <span className="w-px bg-line mx-1" />
        {PRIORITIES.map((p) => (
          <button key={p || 'all'} onClick={() => setPriority(p)} className={cn('px-2.5 py-1 rounded font-mono border', priority === p ? 'border-signal text-signal' : 'border-line text-mut hover:text-gray-300')}>{p || 'all priority'}</button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>
      ) : !hasData ? (
        <Card><CardContent><p className="text-gray-500 text-sm py-6 text-center">No reviews yet — the review-sync cron pulls the public App Store feed once an iOS PromotedApp is configured.</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {reviews!.map((r) => (
            <Card key={r.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {r.sentiment && <span className={cn(chip, SENT_CLS[r.sentiment] ?? SENT_CLS.neutral)}>{r.sentiment}</span>}
                      {r.priority && <span className={cn(chip, PRIO_CLS[r.priority] ?? PRIO_CLS.P3)}>{r.priority}</span>}
                      <span className="text-xs text-dim font-mono">{'★'.repeat(r.rating ?? 0)}{'☆'.repeat(5 - (r.rating ?? 0))} · {r.country ?? ''} · {r.reviewedAt}</span>
                    </div>
                    {r.title && <p className="font-medium text-sm mt-1.5">{r.title}</p>}
                    {r.body && <p className="text-sm text-mut mt-0.5 line-clamp-3">{r.body}</p>}
                    {r.topics.length > 0 && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {r.topics.map((t) => <span key={t} className="text-[10px] font-mono text-dim bg-surface border border-line rounded px-1.5 py-0.5">{t}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
