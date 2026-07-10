'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { cn, api } from '@/lib/utils'
import { GrowthTabs } from '../_ui'

interface Competitor {
  id: string
  externalId: string
  relevance: string | null
  appName: string | null
  advertiser: string | null
  adFormat: string | null
  region: string | null
  language: string | null
  adDays: number | null
  impressions: string | null
  originalPostUrl: string | null
  ratio: string | null
  duration: number | null
  sellingPoints: unknown
  emotionalTriggers: unknown
  screenUnderstanding: unknown
  aiPrompt: string | null
  transcript: string | null
  assetId: string | null
}

interface SaveState {
  open: boolean
  url: string
  status: 'idle' | 'saving' | 'saved' | 'error'
  msg?: string
}

const chip = 'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-mono'
const RELEVANCE = ['', 'core', 'adjacent-dating', 'adjacent-livechat', 'adjacent-romance-fiction']

function relCls(r: string | null): string {
  if (r === 'core') return 'bg-ok/10 text-ok border border-ok/25'
  if (r?.startsWith('adjacent')) return 'bg-signal/10 text-signal border border-signal/25'
  return 'bg-mut/10 text-mut border border-line'
}
function asArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []
}
function fmtImpr(s: string | null): string {
  if (!s) return '—'
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

export default function CompetitorsPage() {
  const [rows, setRows] = useState<Competitor[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [relevance, setRelevance] = useState('')
  const [sort, setSort] = useState('impressions')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [save, setSave] = useState<Record<string, SaveState>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ sort, limit: '60' })
      if (relevance) qs.set('relevance', relevance)
      if (q.trim()) qs.set('app', q.trim())
      const res = await fetch(api(`/api/competitors?${qs.toString()}`))
      const d = await res.json()
      setRows(Array.isArray(d.competitors) ? d.competitors : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [relevance, sort, q])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function openSave(c: Competitor) {
    setSave((s) => ({ ...s, [c.id]: { open: true, url: c.originalPostUrl ?? '', status: 'idle' } }))
  }
  function setUrl(id: string, url: string) {
    setSave((s) => ({ ...s, [id]: { ...s[id], url } }))
  }
  async function doSave(c: Competitor) {
    const url = (save[c.id]?.url ?? '').trim()
    if (!url) return
    setSave((s) => ({ ...s, [c.id]: { ...s[c.id], status: 'saving', msg: undefined } }))
    try {
      const res = await fetch(api('/api/competitors/media'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitorCreativeId: c.id, sourceUrl: url }),
      })
      const d = await res.json()
      if (!res.ok || d.error) {
        setSave((s) => ({ ...s, [c.id]: { ...s[c.id], status: 'error', msg: d.error || 'Save failed' } }))
        return
      }
      setSave((s) => ({ ...s, [c.id]: { ...s[c.id], status: 'saved' } }))
    } catch (e) {
      setSave((s) => ({ ...s, [c.id]: { ...s[c.id], status: 'error', msg: e instanceof Error ? e.message : 'Save failed' } }))
    }
  }

  const coreCount = rows?.filter((r) => r.relevance === 'core').length ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Growth</h1>
          <p className="text-gray-500 text-sm mt-1">Competitor creative intelligence — browse, read the AI analysis, remix winners</p>
        </div>
        <div className="flex gap-2 text-xs font-mono">
          <span className={cn(chip, 'bg-ok/10 text-ok border border-ok/25')}>core · {coreCount}</span>
          <span className={cn(chip, 'bg-mut/10 text-mut border border-line')}>shown · {rows?.length ?? 0}</span>
        </div>
      </div>

      <GrowthTabs />

      <div className="flex gap-2 flex-wrap items-center text-xs">
        {RELEVANCE.map((r) => (
          <button
            key={r || 'all'}
            onClick={() => setRelevance(r)}
            className={cn('px-2.5 py-1 rounded font-mono border', relevance === r ? 'border-signal text-signal' : 'border-line text-mut hover:text-gray-300')}
          >
            {r || 'all'}
          </button>
        ))}
        <span className="w-px bg-line mx-1 self-stretch" />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="bg-surface border border-line rounded px-2 py-1 font-mono text-mut"
        >
          <option value="impressions">impressions</option>
          <option value="adDays">ad days</option>
          <option value="recent">recent</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search app…"
          className="bg-surface border border-line rounded px-2 py-1 font-mono text-gray-300 placeholder:text-dim flex-1 min-w-[8rem]"
        />
      </div>

      {loading && rows === null ? (
        <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>
      ) : !rows || rows.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-gray-500 text-sm py-6 text-center">
              No competitors match. Ingest a batch via POST /api/ingest/competitor (Approach B export), then filter here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => {
            const isOpen = expanded.has(c.id)
            const st = save[c.id]
            const sps = asArr(c.sellingPoints)
            const emos = asArr(c.emotionalTriggers)
            const screen = asArr(c.screenUnderstanding)
            return (
              <Card key={c.id}>
                <CardContent className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{c.appName ?? c.externalId}</span>
                        {c.relevance && <span className={cn(chip, relCls(c.relevance))}>{c.relevance}</span>}
                      </div>
                      <p className="text-xs text-dim font-mono mt-1">
                        {[c.advertiser, c.region, c.language, c.ratio, c.duration ? `${c.duration}s` : null, c.adFormat]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="text-xs text-mut font-mono mt-1">
                        {c.adDays ? `${c.adDays}d live` : 'ad days n/a'} · {fmtImpr(c.impressions)} impr
                      </p>
                      {sps.length > 0 && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {sps.slice(0, 6).map((s) => (
                            <span key={s} className="text-[10px] font-mono text-signal/80 bg-signal/5 border border-signal/20 rounded px-1.5 py-0.5">
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Link href={`/creatives/remix?competitorId=${c.id}`} className="text-xs text-signal hover:underline whitespace-nowrap">
                        Remix →
                      </Link>
                      <button onClick={() => toggle(c.id)} className="text-xs text-mut hover:text-gray-300 whitespace-nowrap">
                        {isOpen ? 'Hide analysis' : 'AI analysis'}
                      </button>
                      <button onClick={() => (st?.open ? undefined : openSave(c))} className="text-xs text-mut hover:text-gray-300 whitespace-nowrap">
                        {st?.status === 'saved' ? '✓ video saved' : 'Save video'}
                      </button>
                    </div>
                  </div>

                  {/* Tier-2 save row */}
                  {st?.open && st.status !== 'saved' && (
                    <div className="mt-3 border-t border-line pt-3">
                      <p className="text-[11px] text-dim mb-1.5">
                        Store the full video to our GCS (internal reference only, ≤50MB). Paste a direct video URL — the original-post link is prefilled but is often a page, not a video file.
                      </p>
                      <div className="flex gap-2">
                        <input
                          value={st.url}
                          onChange={(e) => setUrl(c.id, e.target.value)}
                          placeholder="https://…/video.mp4"
                          className="flex-1 bg-surface border border-line rounded px-2 py-1 font-mono text-xs text-gray-300 placeholder:text-dim"
                        />
                        <button
                          onClick={() => doSave(c)}
                          disabled={st.status === 'saving' || !st.url.trim()}
                          className="text-xs px-3 py-1 rounded border border-signal text-signal hover:bg-signal/10 disabled:opacity-40"
                        >
                          {st.status === 'saving' ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                      {st.status === 'error' && <p className="text-[11px] text-bad mt-1.5">{st.msg}</p>}
                    </div>
                  )}

                  {/* AI analysis */}
                  {isOpen && (
                    <div className="mt-3 border-t border-line pt-3 space-y-2.5">
                      {c.originalPostUrl && (
                        <a href={c.originalPostUrl} target="_blank" rel="noreferrer" className="text-xs text-signal hover:underline inline-block">
                          View original ↗
                        </a>
                      )}
                      {emos.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-dim mb-1">Emotional triggers</p>
                          <div className="flex gap-1.5 flex-wrap">
                            {emos.map((e) => (
                              <span key={e} className="text-[10px] font-mono text-mut bg-surface border border-line rounded px-1.5 py-0.5">{e}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {screen.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-dim mb-1">Screen understanding (anti-reference — never depicted in our remix)</p>
                          <div className="flex gap-1.5 flex-wrap">
                            {screen.map((s) => (
                              <span key={s} className="text-[10px] font-mono text-mut bg-surface border border-line rounded px-1.5 py-0.5">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {c.aiPrompt && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-dim mb-1">AppGrowing-derived prompt</p>
                          <pre className="text-[11px] text-mut bg-surface border border-line rounded p-2 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{c.aiPrompt}</pre>
                        </div>
                      )}
                      {c.transcript && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-dim mb-1">Transcript</p>
                          <p className="text-[11px] text-mut line-clamp-3">{c.transcript}</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
