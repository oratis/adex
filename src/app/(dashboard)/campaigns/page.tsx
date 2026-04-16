'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
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

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', platform: 'google', objective: 'awareness',
    targetCountries: [] as string[], ageMin: 18, ageMax: 65, gender: 'all',
    startDate: '', endDate: '', budgetType: 'daily', budgetAmount: 50,
  })

  useEffect(() => {
    loadCampaigns()
  }, [])

  async function loadCampaigns() {
    const res = await fetch(api('/api/campaigns'))
    const data = await res.json()
    setCampaigns(Array.isArray(data) ? data : [])
  }

  function toggleCountry(code: string) {
    setForm(f => ({
      ...f,
      targetCountries: f.targetCountries.includes(code)
        ? f.targetCountries.filter(c => c !== code)
        : [...f.targetCountries, code],
    }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch(api('/api/campaigns'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          platform: form.platform,
          objective: form.objective,
          targetCountries: form.targetCountries,
          ageMin: form.ageMin,
          ageMax: form.ageMax,
          gender: form.gender,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
        }),
      })
      const campaign = await res.json()

      // Create budget
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

      setShowCreate(false)
      setForm({ name: '', platform: 'google', objective: 'awareness', targetCountries: [], ageMin: 18, ageMax: 65, gender: 'all', startDate: '', endDate: '', budgetType: 'daily', budgetAmount: 50 })
      loadCampaigns()
    } finally {
      setLoading(false)
    }
  }

  async function launchCampaign(id: string) {
    if (!confirm('Launch this campaign to the ad platform?')) return
    const res = await fetch(api(`/api/campaigns/${id}/launch`), { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      loadCampaigns()
    } else {
      alert(data.error || 'Launch failed')
    }
  }

  async function deleteCampaign(id: string) {
    if (!confirm('Delete this campaign?')) return
    await fetch(api(`/api/campaigns/${id}`), { method: 'DELETE' })
    loadCampaigns()
  }

  const statusVariant = (s: string) => {
    switch (s) {
      case 'active': return 'success' as const
      case 'paused': return 'warning' as const
      case 'completed': return 'info' as const
      default: return 'default' as const
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your ad campaigns across all platforms</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ New Campaign</Button>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500">No campaigns yet. Create your first campaign to start advertising.</p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}>Create Campaign</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <Card key={c.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{c.name}</h3>
                        <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        <span className="capitalize">{c.platform}</span>
                        <span>&middot;</span>
                        <span className="capitalize">{c.objective || 'N/A'}</span>
                        {c.targetCountries && (
                          <>
                            <span>&middot;</span>
                            <span>{JSON.parse(c.targetCountries).join(', ')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.status === 'draft' && (
                      <Button size="sm" onClick={() => launchCampaign(c.id)}>Launch</Button>
                    )}
                    <Button size="sm" variant="danger" onClick={() => deleteCampaign(c.id)}>Delete</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New Campaign" className="max-w-2xl">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Campaign Name</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Campaign" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Platform</label>
              <Select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>
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
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create Campaign'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
