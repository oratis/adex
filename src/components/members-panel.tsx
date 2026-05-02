'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { api } from '@/lib/utils'

interface Member {
  id: string
  userId: string
  email: string
  name: string | null
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
}

interface Invite {
  id: string
  email: string
  role: 'admin' | 'member'
  expiresAt: string
  createdAt: string
}

export function MembersPanel() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [inviting, setInviting] = useState(false)
  const [devUrl, setDevUrl] = useState<string | null>(null)
  const [newOrgName, setNewOrgName] = useState('')
  const [creating, setCreating] = useState(false)
  const [orgRole, setOrgRole] = useState<string>('member')

  const isAdmin = orgRole === 'admin' || orgRole === 'owner'

  useEffect(() => {
    fetch(api('/api/orgs')).then((r) => r.json()).then((list) => {
      if (Array.isArray(list)) {
        const active = list.find((o: { isActive: boolean }) => o.isActive)
        if (active) setOrgRole(active.role)
      }
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [mRes, iRes] = await Promise.all([
        fetch(api('/api/orgs/members')),
        isAdmin
          ? fetch(api('/api/orgs/invites'))
          : Promise.resolve(new Response(JSON.stringify([]))),
      ])
      const mData = await mRes.json()
      const iData = await iRes.json()
      if (Array.isArray(mData)) setMembers(mData)
      if (Array.isArray(iData)) setInvites(iData)
    } catch {
      toast({ variant: 'error', title: 'Failed to load members' })
    } finally {
      setLoading(false)
    }
  }, [isAdmin, toast])

  useEffect(() => {
    load()
  }, [load])

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setDevUrl(null)
    try {
      const res = await fetch(api('/api/orgs/invites'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Invite failed')
      toast({ variant: 'success', title: 'Invite sent' })
      setInviteEmail('')
      if (data.devInviteUrl) setDevUrl(data.devInviteUrl)
      load()
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Invite failed',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setInviting(false)
    }
  }

  async function revokeInvite(id: string) {
    if (!(await confirm({ message: 'Revoke this invite?', confirmLabel: 'Revoke', variant: 'danger' }))) return
    try {
      const res = await fetch(api(`/api/orgs/invites/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast({ variant: 'success', title: 'Invite revoked' })
      load()
    } catch {
      toast({ variant: 'error', title: 'Revoke failed' })
    }
  }

  async function changeRole(memberId: string, role: 'owner' | 'admin' | 'member') {
    try {
      const res = await fetch(api(`/api/orgs/members/${memberId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Role update failed')
      toast({ variant: 'success', title: 'Role updated' })
      load()
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Role update failed',
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  async function removeMember(memberId: string, name: string) {
    if (
      !(await confirm({
        title: 'Remove member',
        message: `Remove ${name} from the workspace?`,
        confirmLabel: 'Remove',
        variant: 'danger',
      }))
    )
      return
    try {
      const res = await fetch(api(`/api/orgs/members/${memberId}`), { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Remove failed')
      toast({ variant: 'success', title: 'Member removed' })
      if (data.self) {
        window.location.href = '/dashboard'
        return
      }
      load()
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Remove failed',
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  async function createOrg(e: React.FormEvent) {
    e.preventDefault()
    if (!newOrgName.trim()) return
    setCreating(true)
    try {
      const res = await fetch(api('/api/orgs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newOrgName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Create failed')
      // Switch to the new org
      await fetch(api('/api/orgs/switch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: data.id }),
      })
      toast({ variant: 'success', title: 'Workspace created' })
      window.location.reload()
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Create failed',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setCreating(false)
    }
  }

  const roleBadge = (r: string) => {
    if (r === 'owner') return <Badge variant="success">Owner</Badge>
    if (r === 'admin') return <Badge variant="info">Admin</Badge>
    return <Badge>Member</Badge>
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Loading…</div>
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Members ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Email</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2">{m.name || '—'}</td>
                  <td className="py-2 text-gray-600">{m.email}</td>
                  <td className="py-2">{roleBadge(m.role)}</td>
                  <td className="py-2 text-right space-x-2">
                    {isAdmin && (
                      <Select
                        value={m.role}
                        onChange={(e) =>
                          changeRole(m.id, e.target.value as 'owner' | 'admin' | 'member')
                        }
                        className="inline-block w-28"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        {orgRole === 'owner' && <option value="owner">Owner</option>}
                      </Select>
                    )}
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => removeMember(m.id, m.name || m.email)}
                      >
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={sendInvite} className="flex gap-2 items-end flex-wrap">
              <div className="flex-1 min-w-64">
                <label className="block text-sm font-medium mb-1">Email</label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <Select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
              <Button type="submit" disabled={inviting}>
                {inviting ? 'Sending…' : 'Send Invite'}
              </Button>
            </form>
            {devUrl && (
              <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs p-3 rounded-lg">
                <p className="font-semibold mb-1">Dev mode — SMTP not configured. Share this link manually:</p>
                <a href={devUrl} className="underline break-all">{devUrl}</a>
              </div>
            )}

            {invites.length > 0 && (
              <div className="mt-5 pt-5 border-t">
                <h4 className="text-sm font-medium mb-2">Pending invites ({invites.length})</h4>
                <table className="w-full text-sm">
                  <tbody>
                    {invites.map((i) => (
                      <tr key={i.id} className="border-b last:border-0">
                        <td className="py-2">{i.email}</td>
                        <td className="py-2">{roleBadge(i.role)}</td>
                        <td className="py-2 text-gray-500">
                          expires {new Date(i.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="py-2 text-right">
                          <Button size="sm" variant="outline" onClick={() => revokeInvite(i.id)}>
                            Revoke
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create a new workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createOrg} className="flex gap-2 items-end max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Name</label>
              <Input
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Acme Inc."
                required
              />
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </form>
          <p className="text-xs text-gray-500 mt-2">
            You\u2019ll be the owner. Your existing workspaces remain accessible via the sidebar switcher.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
