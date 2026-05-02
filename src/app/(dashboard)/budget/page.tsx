'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { StatCard } from '@/components/layout/stat-card'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { formatCurrency, api } from '@/lib/utils'

interface Budget {
  id: string
  type: string
  amount: number
  currency: string
  spent: number
  campaignId: string | null
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

type FormState = {
  campaignId: string
  type: string
  amount: number
  currency: string
  startDate: string
  endDate: string
}

const emptyForm: FormState = {
  campaignId: '', type: 'daily', amount: 50, currency: 'USD', startDate: '', endDate: '',
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'JPY', 'AUD', 'CAD', 'HKD', 'SGD']

export default function BudgetPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [budgetRes, campaignRes] = await Promise.all([
        fetch(api('/api/budgets')),
        fetch(api('/api/campaigns')),
      ])
      const budgetData = await budgetRes.json()
      const campaignData = await campaignRes.json()
      setBudgets(Array.isArray(budgetData) ? budgetData : [])
      setCampaigns(Array.isArray(campaignData) ? campaignData : [])
    } catch {
      toast({ variant: 'error', title: 'Failed to load budgets' })
    }
  }

  function openEdit(b: Budget) {
    setEditingId(b.id)
    setForm({
      campaignId: b.campaignId || '',
      type: b.type,
      amount: b.amount,
      currency: b.currency,
      startDate: b.startDate ? b.startDate.slice(0, 10) : '',
      endDate: b.endDate ? b.endDate.slice(0, 10) : '',
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
        campaignId: form.campaignId || undefined,
        type: form.type,
        amount: form.amount,
        currency: form.currency,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      }

      if (editingId) {
        const res = await fetch(api(`/api/budgets/${editingId}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Update failed')
        toast({ variant: 'success', title: 'Budget updated' })
      } else {
        const res = await fetch(api('/api/budgets'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Create failed')
        toast({ variant: 'success', title: 'Budget added' })
      }

      closeModals()
      loadData()
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

  async function deleteBudget(id: string) {
    if (
      !(await confirm({
        message: 'Delete this budget?',
        confirmLabel: 'Delete',
        variant: 'danger',
      }))
    )
      return
    try {
      const res = await fetch(api(`/api/budgets/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast({ variant: 'success', title: 'Budget deleted' })
      loadData()
    } catch {
      toast({ variant: 'error', title: 'Delete failed' })
    }
  }

  const totalBudget = budgets.reduce((s, b) => s + (b.amount || 0), 0)
  const totalSpent = budgets.reduce((s, b) => s + (b.spent || 0), 0)
  const remaining = totalBudget - totalSpent
  const utilization = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0

  const modalOpen = showCreate || editingId !== null
  const modalTitle = editingId ? 'Edit Budget' : 'Add Budget'
  const submitLabel = editingId ? 'Save Changes' : 'Add Budget'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Budget</h1>
          <p className="text-gray-500 text-sm mt-1">Manage advertising budgets across campaigns</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setShowCreate(true) }}>+ Add Budget</Button>
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
                    <th className="pb-3 font-medium text-right">Actions</th>
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
                        <td className="py-3 text-right">
                          <div className="inline-flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => openEdit(b)}>Edit</Button>
                            <Button size="sm" variant="danger" onClick={() => deleteBudget(b.id)}>Delete</Button>
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

      <Modal open={modalOpen} onClose={closeModals} title={modalTitle}>
        <form onSubmit={handleSubmit} className="space-y-4">
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
              <label className="block text-sm font-medium mb-1">Currency</label>
              <Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Amount</label>
            <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: +e.target.value }))} min={1} step={0.01} required />
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
            <Button type="button" variant="outline" onClick={closeModals}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Saving...' : submitLabel}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
