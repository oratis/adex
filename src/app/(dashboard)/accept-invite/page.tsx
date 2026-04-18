'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/utils'

function AcceptInviteInner() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token') || ''

  const [state, setState] = useState<'idle' | 'accepting' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [orgName, setOrgName] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setState('error')
      setMessage('Missing invite token.')
    }
  }, [token])

  async function handleAccept() {
    setState('accepting')
    try {
      const res = await fetch(api('/api/orgs/accept'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Accept failed')
      setOrgName(data.org?.name || null)
      setState('done')
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 1500)
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'Accept failed')
    }
  }

  return (
    <div className="max-w-xl mx-auto mt-16">
      <Card>
        <CardHeader>
          <CardTitle>Accept Workspace Invite</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'idle' && (
            <>
              <p className="text-sm text-gray-600">
                You&apos;ve been invited to join a workspace on Adex. Click below to accept.
              </p>
              <Button onClick={handleAccept} disabled={!token}>
                Accept Invite
              </Button>
            </>
          )}
          {state === 'accepting' && <p className="text-sm text-gray-500">Accepting…</p>}
          {state === 'done' && (
            <>
              <div className="text-4xl">✓</div>
              <p className="text-sm">
                Joined{orgName ? ` ${orgName}` : ''}. Redirecting to dashboard…
              </p>
            </>
          )}
          {state === 'error' && (
            <>
              <div className="bg-red-50 border border-red-200 text-red-800 text-sm p-3 rounded-lg">
                {message}
              </div>
              <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
                Go to dashboard
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
      <AcceptInviteInner />
    </Suspense>
  )
}
