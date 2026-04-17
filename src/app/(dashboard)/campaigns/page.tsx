'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import Link from 'next/link'
import { api } from '@/lib/utils'

const COUNTRIES = [
  { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' }, { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' },
  { code: 'JP', name: 'Japan' }, { code: 'KR', name: 'South Korea' },
  { code: 'BR', name: 'Brazil' }, { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' }, { code: 'TH', name: 'Thailand' },
  { code: 'VN', name: 'Vietnam' }, { code: 'MX', name: 'Mexico' },
  { code: 'SA', name: 'Saudi Arabia' }, { code: 'AE', name: 'UAE' },
  { code: 'TR', name: 'Turkey' }, { code: 'PH', name: 'Philippines' },
  { code: 'TW', name: 'Taiwan' }, { code: 'SG', name: 'Singapore' },
]

interface Campaign {
  id: string
  name: string
  platform: string
  status: string
  objective: string | null
  targetCountries: string | null
  ageMin: number | null
  ageMax: number | null
  gender: string | null
  startDate: string | null
  endDate: string | null
  createdAt: string
  budgets: { amount: number; spent: number; type: string }[]
  adGroups: { id: string; ads: { id: string }[] }[]
}

type FormState = {
  name: string
  platform: string
  objective: string
  targetCountries: string[]
  ageMin: number
  ageMax: number
  gender: string
  startDate: string
  endDate: string
  budgetType: string
  budgetAmount: number
}

const emptyForm: FormState = {
  name: '', platform: 'google', objective: 'awareness',
  targetCountries: [], ageMin: 18, ageMax: 65, gender: 'all',
  startDate: '', endDate: '', budgetType: 'daily', budgetAmount: 50,
}

export default function CampaignsPage() {
  const { toast } = useToast()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  useEffect(() => {
    loadCampaigns()
  }, [])

  async function loadCampaigns() {
    try {
      const res = await fetch(api('/api/campaigns'))
      const data = await res.json()
      setCampaigns(Array.isArray(data) ? data : [])
    } catch {
      toast({ variant: 'error', title: 'Failed to load campaigns' })
    }
  }

  function toggleCountry(code: string) {
    setForm(f => ({
      ...f,
      targetCountries: f.targetCountries.includes(code)
        ? f.targetCountries.filter(c => c !== code)
        : [...f.targetCountries, code],
    }))
  }

  function openEdit(c: Campaign) {
    setEditingId(c.id)
    setForm({
      name: c.name,
      platform: c.platform,
      objective: c.objective || 'awareness',
      targetCountries: c.targetCountries ? (JSON.parse(c.targetCountries) as string[]) : [],
      ageMin: c.ageMin ?? 18,
      ageMax: c.ageMax ?? 65,
      gender: c.gender || 'all',
      startDate: c.startDate ? c.startDate.slice(0, 10) : '',
      endDate: c.endDate ? c.endDate.slice(0, 10) : '',
      budgetType: c.budgets?.[0]?.type || 'daily',
      budgetAmount: c.budgets?.[0]?.amount || 50,
    })
  }

  function closeModals() {
    setShowCreate(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        name: form.name,
        platform: form.platform,
        objective: form.objective,
        targetCountries: form.targetCountries,
        ageMin: form.ageMin,
        ageMax: form.ageMax,
        gender: form.gender,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      }

      if (editingId) {
        const res = await fetch(api(`/api/campaigns/${editingId}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Update failed')
        toast({ variant: 'success', title: 'Campaign updated' })
      } else {
        const res = await fetch(api('/api/campaigns'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const campaign = await res.json()
        if (!res.ok) throw new Error(campaign.error || 'Create failed')

        if (campaign.id) {
          await fetch(api('/api/budgets'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaignId: campaign.id,
              type: form.budgetType,
              amount: form.budgetAmount,
            }),
          })
        }
        toast({ variant: 'success', title: 'Campaign created' })
      }

      closeModals()
      loadCampaigns()
    } catch (err) {
      toast({
        variant: 'error',
        title: editingId ? 'Update failed' : 'Create failed',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(false)
    }
  }

  async function launchCampaign(id: string) {
    if (!confirm('Launch this campaign to the ad platform?')) return
    try {
      const res = await fetch(api(`/api/campaigns/${id}/launch`), { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast({ variant: 'success', title: 'Campaign launched' })
        loadCampaigns()
      } else {
        toast({ variant: 'error', title: 'Launch failed', description: data.error })
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Launch failed', description: err instanceof Error ? err.message : undefined })
    }
  }

  async function toggleStatus(c: Campaign) {
    const nextStatus = c.status === 'active' ? 'paused' : 'active'
    try {
      const res = await fetch(api(`/api/campaigns/${c.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!res.ok) throw new Error()
      toast({ variant: 'success', title: `Campaign ${nextStatus}` })
      loadCampaigns()
    } catch {
      toast({ variant: 'error', title: 'Status update failed' })
    }
  }

  async function deleteCampaign(id: string) {
    if (!confirm('Delete this campaign? This cannot be undone.')) return
    try {
      const res = await fetch(api(`/api/campaigns/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast({ variant: 'success', title: 'Campaign deleted' })
      loadCampaigns()
    } catch {
      toast({ variant: 'error', title: 'Delete failed' })
    }
  }

  const statusVariant = (s: string) => {
    switch (s) {
      case 'active': return 'success' as const
      case 'paused': return 'warning' as const
      case 'completed': return 'info' as const
      default: return 'default' as const
    }
  }

  const modalOpen = showCreate || editingId !== null
  const modalTitle = editingId ? 'Edit Campaign' : 'Create New Campaign'
  const submitLabel = editingId ? 'Save Changes' : 'Create Campaign'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your ad campaigns across all platforms</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setShowCreate(true) }}>+ New Campaign</Button>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500">No campaigns yet. Create your first campaign to start advertising.</p>
            <Button className="mt-4" onClick={() => { setForm(emptyForm); setShowCreate(true) }}>Create Campaign</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <Card key={c.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="font-semibold hover:text-blue-600 hover:underline truncate"
                        >
                          {c.name}
                        </Link>
                        <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        <span className="capitalize">{c.platform}</span>
                        <span>&middot;</span>
                        <span className="capitalize">{c.objective || 'N/A'}</span>
                        {c.targetCountries && (
                          <>
                            <span>&middot;</span>
                            <span>{(JSON.parse(c.targetCountries) as string[]).join(', ')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.status === 'draft' && (
                      <Button size="sm" onClick={() => launchCampaign(c.id)}>Launch</Button>
                    )}
                    {c.status === 'active' && (
                      <Button size="sm" variant="outline" onClick={() => toggleStatus(c)}>Pause</Button>
                    )}
                    {c.status === 'paused' && (
                      <Button size="sm" onClick={() => toggleStatus(c)}>Resume</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openEdit(c)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => deleteCampaign(c.id)}>Delete</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModals} title={modalTitle} className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Campaign Name</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Campaign" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Platform</label>
              <Select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} disabled={!!editingId}>
                <option value="google">Google Ads</option>
                <option value="meta">Meta (Facebook/Instagram)</option>
                <option value="tiktok">TikTok</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Objective</label>
              <Select value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))}>
                <option value="awareness">Brand Awareness</option>
                <option value="consideration">Consideration</option>
                <option value="conversion">Conversion</option>
                <option value="app_install">App Install</option>
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Target Countries</label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto border rounded-lg p-3">
              {COUNTRIES.map(c => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => toggleCountry(c.code)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.targetCountries.includes(c.code)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {c.code} - {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Age Min</label>
              <Input type="number" value={form.ageMin} onChange={e => setForm(f => ({ ...f, ageMin: +e.target.value }))} min={13} max={65} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Age Max</label>
              <Input type="number" value={form.ageMax} onChange={e => setForm(f => ({ ...f, ageMax: +e.target.value }))} min={13} max={65} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Gender</label>
              <Select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                <option value="all">All</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Start Date</label>
              <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Date</label>
              <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
            </div>
          </div>

          {!editingId && (
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Budget</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Budget Type</label>
                  <Select value={form.budgetType} onChange={e => setForm(f => ({ ...f, budgetType: e.target.value }))}>
                    <option value="daily">Daily</option>
                    <option value="lifetime">Lifetime</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Amount (USD)</label>
                  <Input type="number" value={form.budgetAmount} onChange={e => setForm(f => ({ ...f, budgetAmount: +e.target.value }))} min={1} step={0.01} />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Edit budgets on the <span className="font-medium">Budget</span> page.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={closeModals}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Saving...' : submitLabel}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
