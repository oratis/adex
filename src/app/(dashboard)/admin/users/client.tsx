'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { api } from '@/lib/utils'

type U = {
  id: string
  email: string
  name: string | null
  isPlatformAdmin: boolean
  effectiveAdmin: boolean
  createdAt: string
  orgs: number
}

export function UsersClient({
  currentUserId,
  users: initial,
}: {
  currentUserId: string
  users: U[]
}) {
  const confirm = useConfirm()
  const [users, setUsers] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)

  async function setAdmin(u: U, on: boolean) {
    if (u.id === currentUserId && !on) {
      if (
        !(await confirm({
          title: 'Remove your own admin?',
          message: 'You are about to remove your own platform-admin status. Continue?',
          confirmLabel: 'Remove admin',
          variant: 'danger',
        }))
      )
        return
    }
    setBusy(u.id)
    try {
      const res = await fetch(api('/api/admin/users'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, isPlatformAdmin: on }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        setUsers(
          users.map((x) =>
            x.id === u.id
              ? {
                  ...x,
                  isPlatformAdmin: on,
                  // env-fallback may still keep effectiveAdmin true; refetch if you care
                  effectiveAdmin: on || x.effectiveAdmin,
                }
              : x
          )
        )
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-gray-600 mt-1">
          Every registered user. Promote to <strong>platform admin</strong> to grant
          invite-code minting + admin-page access. Users with effectiveAdmin=true via the
          PLATFORM_ADMIN_EMAILS env var show as admin even when the column is false.
        </p>
      </div>

      {users.length === 0 && <p className="text-sm text-gray-500">No users yet.</p>}

      <div className="space-y-2">
        {users.map((u) => (
          <Card key={u.id}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{u.name || u.email}</span>
                  {u.id === currentUserId && (
                    <Badge className="bg-blue-100 text-blue-700">you</Badge>
                  )}
                  {u.effectiveAdmin && (
                    <Badge className="bg-purple-100 text-purple-700">platform admin</Badge>
                  )}
                  {u.effectiveAdmin && !u.isPlatformAdmin && (
                    <Badge className="bg-gray-100 text-gray-600 text-[10px]">via env</Badge>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {u.email} · {u.orgs} org(s) · joined {new Date(u.createdAt).toLocaleDateString()}
                </div>
              </div>
              {u.isPlatformAdmin ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAdmin(u, false)}
                  disabled={busy === u.id}
                >
                  Demote
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setAdmin(u, true)}
                  disabled={busy === u.id}
                >
                  Promote
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
