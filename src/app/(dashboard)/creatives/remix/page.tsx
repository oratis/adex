'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

interface Competitor {
  id: string
  externalId: string
  appName: string | null
  advertiser: string | null
  relevance: string | null
  ratio: string | null
  duration: number | null
  adDays: number | null
  impressions: string | null
  sellingPoints: unknown
}

interface RemixRender {
  creativeId: string
  assetId: string
  name: string
  competitor: string
  status: string // generating | ready | failed
  fileUrl: string | null
  startedAt: number
}

const DEFAULT_BRIEF = {
  product: 'Cuddler',
  positioning: "an AI companion who's always there",
  audience: '18–28, late-night, ex-Character-AI',
  artDirection: 'warm cozy 2.5D animation, amber & dusk-blue palette',
  cta: 'Meet yours',
  differentiation: 'Not a character to collect — one companion who remembers you.',
}

const RELEVANCE_OPTS = ['all', 'core', 'adjacent-dating', 'adjacent-livechat', 'adjacent-romance-fiction']

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
function relevanceTone(r: string | null): 'success' | 'info' | 'default' {
  if (r === 'core') return 'success'
  if (r?.startsWith('adjacent')) return 'info'
  return 'default'
}

export default function RemixStudioPage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [loading, setLoading] = useState(false)
  const [relevance, setRelevance] = useState('all')
  const [sort, setSort] = useState('impressions')
  const [selected, setSelected] = useState<Competitor | null>(null)

  const [brief, setBrief] = useState(DEFAULT_BRIEF)
  const [forbidden, setForbidden] = useState('')
  const [generating, setGenerating] = useState(false)
  const [renders, setRenders] = useState<RemixRender[]>([])
  const [, setTick] = useState(0)

  // Load recent remixes so a refresh keeps history (not just this session's renders).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(api('/api/creatives/remix?list=1'))
        const data = await res.json()
        if (cancelled || !Array.isArray(data.remixes)) return
        const past: RemixRender[] = data.remixes
          .filter((r: { status: string }) => r.status !== 'generating')
          .map((r: { id: string; name: string; status: string; fileUrl: string | null; sourceRef: string | null; createdAt: string }) => ({
            creativeId: r.id,
            assetId: '',
            name: r.name,
            competitor: r.sourceRef ?? '—',
            status: r.status,
            fileUrl: r.fileUrl,
            startedAt: Date.parse(r.createdAt) || 0,
          }))
        setRenders((prev) => (prev.length > 0 ? prev : past))
      } catch {
        // ignore — tray just starts empty
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadCompetitors = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ sort, limit: '50' })
      if (relevance !== 'all') qs.set('relevance', relevance)
      const res = await fetch(api(`/api/competitors?${qs.toString()}`))
      const data = await res.json()
      if (Array.isArray(data.competitors)) setCompetitors(data.competitors)
    } catch {
      // keep prior list on error
    } finally {
      setLoading(false)
    }
  }, [relevance, sort])

  useEffect(() => {
    loadCompetitors()
  }, [loadCompetitors])

  // Deep-link handoff from the competitor panel (?competitorId=…) — preselect it.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('competitorId')
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(api(`/api/competitors?id=${encodeURIComponent(id)}&limit=1`))
        const data = await res.json()
        const c = Array.isArray(data.competitors) ? data.competitors[0] : null
        if (c && !cancelled) {
          setSelected(c)
          setForbidden([c.appName, c.advertiser].filter(Boolean).join(', '))
        }
      } catch {
        // ignore — the user can still pick manually
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function selectCompetitor(c: Competitor) {
    setSelected(c)
    // Prefill "never depict" with the competitor's own brand so IP can't leak in.
    setForbidden([c.appName, c.advertiser].filter(Boolean).join(', '))
  }

  // Poll in-flight renders → promote on completion.
  useEffect(() => {
    if (!renders.some((r) => r.status === 'generating')) return
    const iv = setInterval(async () => {
      for (const r of renders) {
        if (r.status !== 'generating') continue
        try {
          const res = await fetch(api(`/api/creatives/remix?creativeId=${r.creativeId}&assetId=${r.assetId}`))
          const data = await res.json()
          const st: string | undefined = data.creative?.status
          if (st && st !== 'generating') {
            setRenders((prev) =>
              prev.map((x) =>
                x.creativeId === r.creativeId ? { ...x, status: st, fileUrl: data.creative?.fileUrl ?? null } : x,
              ),
            )
          }
        } catch {
          // transient — try again next tick
        }
      }
    }, 5000)
    return () => clearInterval(iv)
  }, [renders])

  // Elapsed-time ticker while anything is rendering.
  useEffect(() => {
    if (!renders.some((r) => r.status === 'generating')) return
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [renders])

  async function generate() {
    if (!selected || generating) return
    setGenerating(true)
    try {
      const res = await fetch(api('/api/creatives/remix'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competitorCreativeId: selected.id,
          ...brief,
          forbidden: forbidden.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
        return
      }
      if (data.creative?.id && data.asset?.id) {
        setRenders((prev) => [
          {
            creativeId: data.creative.id,
            assetId: data.asset.id,
            name: data.creative.name,
            competitor: selected.appName ?? selected.externalId,
            status: 'generating',
            fileUrl: null,
            startedAt: Date.now(),
          },
          ...prev,
        ])
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Remix failed')
    } finally {
      setGenerating(false)
    }
  }

  const borrowed = selected
    ? [
        `${selected.ratio ?? '9:16'} · ${selected.duration ?? 8}s`,
        'single-character hook',
        ...asArr(selected.sellingPoints).slice(0, 2),
      ]
    : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Remix studio</h1>
        <p className="text-gray-500 text-sm mt-1">
          Borrow a competitor winner&apos;s structure — never its IP — and generate your own review-gated creative.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stage 1 — Competitors */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Competitors</CardTitle>
              <span className="text-xs text-gray-500">{competitors.length} shown</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-3">
              <Select value={relevance} onChange={(e) => setRelevance(e.target.value)} className="flex-1">
                {RELEVANCE_OPTS.map((r) => (
                  <option key={r} value={r}>
                    {r === 'all' ? 'All relevance' : r}
                  </option>
                ))}
              </Select>
              <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-32">
                <option value="impressions">Impressions</option>
                <option value="adDays">Ad days</option>
                <option value="recent">Recent</option>
              </Select>
            </div>

            {loading && competitors.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
            ) : competitors.length === 0 ? (
              <div className="py-8 text-center text-gray-500">
                <p className="text-sm font-medium">No competitors yet</p>
                <p className="text-xs mt-1">Ingest a batch via /api/ingest/competitor first.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                {competitors.map((c) => {
                  const active = selected?.id === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCompetitor(c)}
                      className={
                        'w-full text-left rounded-lg p-3 border transition-colors ' +
                        (active
                          ? 'border-signal bg-signal/5'
                          : 'border-line hover:border-signal/40 hover:bg-surface')
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium truncate">{c.appName ?? c.externalId}</span>
                        <Badge variant={relevanceTone(c.relevance)}>{c.relevance ?? 'n/a'}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {[c.advertiser, c.ratio, c.adDays ? `${c.adDays}d live` : null, `${fmtImpr(c.impressions)} impr`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {asArr(c.sellingPoints).length > 0 && (
                        <p className="text-xs text-gray-400 mt-1 truncate">{asArr(c.sellingPoints).slice(0, 3).join(' · ')}</p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stage 2 + 3 — Brief and Renders */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Remix brief</CardTitle>
            </CardHeader>
            <CardContent>
              {!selected ? (
                <div className="py-10 text-center text-gray-500">
                  <p className="text-sm font-medium">Pick a competitor to remix</p>
                  <p className="text-xs mt-1">Its structure seeds the brief — you keep full editorial control.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">
                      Borrowed structure from <span className="text-gray-300">{selected.appName ?? selected.externalId}</span> — not its IP
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {borrowed.map((b, i) => (
                        <span key={i} className="text-xs rounded bg-surface border border-line px-2 py-0.5 text-gray-400">
                          {b}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Product</label>
                      <Input value={brief.product} onChange={(e) => setBrief({ ...brief, product: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">CTA</label>
                      <Input value={brief.cta} onChange={(e) => setBrief({ ...brief, cta: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Positioning</label>
                    <Input value={brief.positioning} onChange={(e) => setBrief({ ...brief, positioning: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Audience</label>
                    <Input value={brief.audience} onChange={(e) => setBrief({ ...brief, audience: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Art direction</label>
                    <Input value={brief.artDirection} onChange={(e) => setBrief({ ...brief, artDirection: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Differentiation (counter-angle)</label>
                    <Input value={brief.differentiation} onChange={(e) => setBrief({ ...brief, differentiation: e.target.value })} />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium mb-1 text-bad">
                      <span aria-hidden>🚫</span>Never depict (competitor IP)
                    </label>
                    <Input
                      value={forbidden}
                      onChange={(e) => setForbidden(e.target.value)}
                      placeholder="brand, characters, logos to keep out"
                    />
                  </div>

                  <Button className="w-full" disabled={generating} onClick={generate}>
                    {generating ? 'Submitting…' : 'Generate remix'}
                  </Button>
                  <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                    <span aria-hidden>🛡️</span>
                    derive, don&apos;t copy · lands review-pending · text2video, no competitor pixels
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Renders</CardTitle>
            </CardHeader>
            <CardContent>
              {renders.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <p className="text-4xl mb-2">♻️</p>
                  <p className="text-sm font-medium">No remixes yet</p>
                  <p className="text-xs mt-1">Generated remixes appear here, then flow to Creative review.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {renders.map((r) => {
                    const elapsed = Math.floor((Date.now() - r.startedAt) / 1000)
                    const mm = Math.floor(elapsed / 60)
                    const ss = elapsed % 60
                    return (
                      <div key={r.creativeId} className="flex gap-3 border border-line rounded-lg p-3">
                        <div className="w-20 aspect-[9/16] bg-gray-900 rounded overflow-hidden flex items-center justify-center shrink-0">
                          {r.status === 'ready' && r.fileUrl ? (
                            <video src={r.fileUrl} controls className="w-full h-full object-cover" />
                          ) : r.status === 'failed' ? (
                            <span className="text-red-400 text-xl">✕</span>
                          ) : (
                            <span className="text-gray-500 text-xs animate-pulse">•••</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{r.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">from {r.competitor}</p>
                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <Badge variant={r.status === 'ready' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>
                              {r.status === 'generating' ? `rendering · ${mm > 0 ? `${mm}m ${ss}s` : `${ss}s`}` : r.status}
                            </Badge>
                            {r.status === 'ready' && <Badge variant="warning">review-pending</Badge>}
                            {r.status === 'ready' && (
                              <Link href="/creatives/review" className="text-xs text-signal hover:underline">
                                Review →
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
