'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { StatCard } from '@/components/layout/stat-card'
import { formatCurrency, api } from '@/lib/utils'

interface Budget {
  id: string
  type: string
  amount: number
  currency: string
  spent: number
  startDate: string | null
  endDate: string | null
  campaign: { id: string; name: string; platform: string } | null
  createdAt: string
}

interface Campaign {
  id: string
  name: string
  platform: string
}

export default function BudgetPage() {
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    campaignId: '', type: 'daily', amount: 50, currency: 'USD', startDate: '', endDate: '',
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [budgetRes, campaignRes] = await Promise.all([
      fetch(api('/api/budgets')),
      fetch(api('/api/campaigns')),
    ])
    const budgetData = await budgetRes.json()
    const campaignData = await campaignRes.json()
    setBudgets(Array.isArray(budgetData) ? budgetData : [])
    setCampaigns(Array.isArray(campaignData) ? campaignData : [])
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch(api('/api/budgets'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: form.campaignId || undefined,
          type: form.type,
          amount: form.amount,
          currency: form.currency,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
        }),
      })
      setShowCreate(false)
      setForm({ campaignId: '', type: 'daily', amount: 50, currency: 'USD', startDate: '', endDate: '' })
      loadData()
    } finally {
      setLoading(false)
    }
  }

  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0)
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0)
  const remaining = totalBudget - totalSpent
  const utilization = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Budget</h1>
          <p className="text-gray-500 text-sm mt-1">Manage advertising budgets across campaigns</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ Add Budget</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Budget" value={formatCurrency(totalBudget)} icon={<span>💰</span>} />
        <StatCard title="Total Spent" value={formatCurrency(totalSpent)} icon={<span>💸</span>} />
        <StatCard title="Remaining" value={formatCurrency(remaining)} changeType={remaining > 0 ? 'positive' : 'negative'} icon={<span>💵</span>} />
        <StatCard title="Utilization" value={`${utilization.toFixed(1)}%`} icon={<span>📊</span>} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Budget Allocations</CardTitle>
        </CardHeader>
        <CardContent>
          {budgets.length === 0 ? (
            <p className="text-gray-500 text-sm py-4 text-center">No budgets configured. Add a budget to get started.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-3 font-medium">Campaign</th>
                    <th className="pb-3 font-medium">Type</th>
                    <th className="pb-3 font-medium">Budget</th>
                    <th className="pb-3 font-medium">Spent</th>
                    <th className="pb-3 font-medium">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {budgets.map((b) => {
                    const pct = b.amount > 0 ? (b.spent / b.amount) * 100 : 0
                    return (
                      <tr key={b.id} className="border-b last:border-0">
                        <td className="py-3">
                          {b.campaign ? (
                            <div>
                              <p className="font-medium">{b.campaign.name}</p>
                              <p className="text-xs text-gray-500 capitalize">{b.campaign.platform}</p>
                            </div>
                          ) : (
                            <span className="text-gray-400">Unassigned</span>
                          )}
                        </td>
                        <td className="py-3 capitalize">{b.type}</td>
                        <td className="py-3">{formatCurrency(b.amount, b.currency)}</td>
                        <td className="py-3">{formatCurrency(b.spent, b.currency)}</td>
                        <td className="py-3 w-48">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 w-12 text-right">{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Budget">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Campaign (optional)</label>
            <Select value={form.campaignId} onChange={e => setForm(f => ({ ...f, campaignId: e.target.value }))}>
              <option value="">General Budget</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.platform})</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="daily">Daily</option>
                <option value="lifetime">Lifetime</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Amount</label>
              <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: +e.target.value }))} min={1} step={0.01} />
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
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Adding...' : 'Add Budget'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
