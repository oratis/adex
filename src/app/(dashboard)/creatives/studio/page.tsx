'use client'

import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, api } from '@/lib/utils'

interface Variant {
  id: string
  platform: string
  format: string
  hook: string | null
  language: string
  headline: string | null
  primaryText: string | null
  cta: string | null
  specStatus: string
}
interface BriefDetail {
  id: string
  name: string
  product: string
  variants: Variant[]
}
interface BriefListItem {
  id: string
  name: string
  status: string
  _count: { variants: number }
}

const PLATFORMS = ['meta', 'tiktok', 'asa', 'google']
const LANGS = ['en', 'ja', 'ko', 'es', 'pt']

const SPEC_CLS: Record<string, string> = {
  conforms: 'bg-ok/10 text-ok border border-ok/25',
  pending: 'bg-mut/10 text-mut border border-line',
  needs_resize: 'bg-warn/10 text-warn border border-warn/25',
  needs_transcode: 'bg-warn/10 text-warn border border-warn/25',
  rejected: 'bg-bad/10 text-bad border border-bad/25',
}

export default function StudioPage() {
  const [briefs, setBriefs] = useState<BriefListItem[]>([])
  const [detail, setDetail] = useState<BriefDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ product: '', audience: '', angle: '', hooks: '', platforms: ['meta', 'tiktok'] as string[], languages: ['en'] as string[] })

  useEffect(() => { loadBriefs() }, [])

  async function loadBriefs() {
    try {
      const d = await (await fetch(api('/api/creatives/studio'))).json()
      setBriefs(Array.isArray(d.briefs) ? d.briefs : [])
    } catch { /* silent */ }
  }
  async function loadDetail(id: string) {
    const d = await (await fetch(api(`/api/creatives/studio?briefId=${id}`))).json()
    if (d.brief) setDetail(d.brief)
  }
  function toggle(key: 'platforms' | 'languages', v: string) {
    setForm((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }))
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.product || form.platforms.length === 0) return
    setBusy(true)
    try {
      const res = await fetch(api('/api/creatives/studio'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, hooks: form.hooks.split(',').map((s) => s.trim()).filter(Boolean) }),
      })
      const d = await res.json()
      if (d.briefId) { await loadBriefs(); await loadDetail(d.briefId) }
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Creative Studio</h1>
        <p className="text-gray-500 text-sm mt-1">Brief → DCO variant matrix — platform-fitted copy across format × hook × language</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>New brief</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={generate} className="space-y-3">
              <div><label className="block text-xs uppercase tracking-wider text-dim mb-1">Product</label><Input value={form.product} onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))} placeholder="Cuddler — Playable Stories" required /></div>
              <div><label className="block text-xs uppercase tracking-wider text-dim mb-1">Audience</label><Input value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))} placeholder="CAI refugees, RP creators" /></div>
              <div><label className="block text-xs uppercase tracking-wider text-dim mb-1">Angle</label><Input value={form.angle} onChange={(e) => setForm((f) => ({ ...f, angle: e.target.value }))} placeholder="turn roleplay into cinematic video" /></div>
              <div><label className="block text-xs uppercase tracking-wider text-dim mb-1">Hooks (comma-sep)</label><Input value={form.hooks} onChange={(e) => setForm((f) => ({ ...f, hooks: e.target.value }))} placeholder="branch moment, chat→film, voice compare" /></div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-dim mb-1">Platforms</label>
                <div className="flex gap-1.5 flex-wrap">
                  {PLATFORMS.map((p) => <button type="button" key={p} onClick={() => toggle('platforms', p)} className={cn('px-2.5 py-1 rounded text-xs font-mono border', form.platforms.includes(p) ? 'border-signal text-signal' : 'border-line text-mut')}>{p}</button>)}
                </div>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-dim mb-1">Languages</label>
                <div className="flex gap-1.5 flex-wrap">
                  {LANGS.map((l) => <button type="button" key={l} onClick={() => toggle('languages', l)} className={cn('px-2.5 py-1 rounded text-xs font-mono border', form.languages.includes(l) ? 'border-ai text-ai' : 'border-line text-mut')}>{l}</button>)}
                </div>
              </div>
              <Button type="submit" disabled={busy} className="w-full">{busy ? 'Generating…' : 'Generate variants'}</Button>
            </form>

            {briefs.length > 0 && (
              <div className="mt-5 pt-4 border-t border-line">
                <p className="text-xs uppercase tracking-wider text-dim mb-2">Briefs</p>
                <div className="space-y-1">
                  {briefs.map((b) => (
                    <button key={b.id} onClick={() => loadDetail(b.id)} className={cn('w-full text-left px-2 py-1.5 rounded text-sm hover:bg-surface flex justify-between', detail?.id === b.id && 'bg-signal/10 text-signal')}>
                      <span className="truncate">{b.name}</span>
                      <span className="text-xs font-mono text-dim">{b._count.variants}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{detail ? `${detail.name} · ${detail.variants.length} variants` : 'Variant matrix'}</CardTitle></CardHeader>
          <CardContent>
            {!detail ? (
              <p className="text-gray-500 text-sm py-8 text-center">Create a brief to fan out the variant matrix.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-line text-left text-dim">
                      <th className="pb-2 font-medium">Platform</th><th className="pb-2 font-medium">Format</th><th className="pb-2 font-medium">Hook</th><th className="pb-2 font-medium">Lang</th><th className="pb-2 font-medium">Headline</th><th className="pb-2 font-medium">CTA</th><th className="pb-2 font-medium text-right">Spec</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.variants.map((v) => (
                      <tr key={v.id} className="border-b border-line last:border-0">
                        <td className="py-2 font-mono">{v.platform}</td>
                        <td className="py-2 font-mono text-mut">{v.format}</td>
                        <td className="py-2 text-mut">{v.hook ?? '—'}</td>
                        <td className="py-2 font-mono text-ai">{v.language}</td>
                        <td className="py-2 max-w-[200px] truncate">{v.headline ?? '—'}</td>
                        <td className="py-2 text-signal">{v.cta ?? '—'}</td>
                        <td className="py-2 text-right"><span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono', SPEC_CLS[v.specStatus] ?? SPEC_CLS.pending)}>{v.specStatus}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
