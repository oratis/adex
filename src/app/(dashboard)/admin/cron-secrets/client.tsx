'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/utils'

type Secret = {
  id: string
  cronPath: string
  description: string | null
  createdAt: string
  rotatedAt: string | null
  lastUsedAt: string | null
  isActive: boolean
}

type ListResponse = {
  knownPaths: string[]
  secrets: Secret[]
}

export function CronSecretsClient() {
  const [data, setData] = useState<ListResponse | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ cronPath: string; token: string } | null>(null)

  async function refresh() {
    const r = await fetch(api('/api/admin/cron-secrets'))
    if (r.ok) setData(await r.json())
  }

  useEffect(() => {
    refresh()
  }, [])

  async function rotate(cronPath: string) {
    if (
      !confirm(
        `Rotate the secret for /api/cron/${cronPath}?\n\nAny scheduler still using the old token will start failing on the next call. Make sure you copy + paste the new token into Cloud Scheduler before that.`
      )
    )
      return
    setBusy(cronPath)
    try {
      const r = await fetch(api('/api/admin/cron-secrets'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronPath }),
      })
      const d = await r.json()
      if (d.error) {
        alert(d.error)
      } else {
        setRevealed({ cronPath: d.cronPath, token: d.token })
        await refresh()
      }
    } finally {
      setBusy(null)
    }
  }

  async function revoke(s: Secret) {
    if (!confirm(`Revoke the secret for /api/cron/${s.cronPath}? Scheduler calls fail until rotated.`)) return
    setBusy(s.id)
    try {
      const r = await fetch(api(`/api/admin/cron-secrets/${s.id}`), { method: 'DELETE' })
      if (r.ok) await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cron secrets · 定时任务密钥</h1>
        <p className="text-sm text-gray-600 mt-1">
          每个 cron 端点单独的可旋转密钥。轮换不会影响其他 cron。轮换后旧 token 立即失效（并发未完成的请求继续）；如果没设置，回退到环境变量 <code>CRON_SECRET</code>。
        </p>
      </div>

      {revealed && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 space-y-2">
            <h3 className="font-semibold text-amber-800">
              ⚠️ Token for /api/cron/{revealed.cronPath} (shown ONCE)
            </h3>
            <code className="block font-mono text-xs bg-white p-3 rounded border break-all">
              {revealed.token}
            </code>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  navigator.clipboard?.writeText(revealed.token).catch(() => {})
                  alert('Copied to clipboard')
                }}
              >
                Copy
              </Button>
              <Button variant="outline" onClick={() => setRevealed(null)}>
                Done — I&apos;ve saved it
              </Button>
            </div>
            <p className="text-xs text-amber-700">
              Update your scheduler with this value as the <code>X-Cron-Secret</code> header.
              You won&apos;t see this token again. Lost it? Click Rotate to get a new one.
            </p>
          </CardContent>
        </Card>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle>Per-cron secrets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.knownPaths.map((path) => {
              const existing = data.secrets.find((s) => s.cronPath === path)
              return (
                <div
                  key={path}
                  className="flex items-center justify-between gap-3 border-t border-gray-100 py-2"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-sm">/api/cron/{path}</code>
                      {existing ? (
                        <Badge
                          className={
                            existing.isActive
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-rose-100 text-rose-700'
                          }
                        >
                          {existing.isActive ? 'active' : 'revoked'}
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-100 text-gray-600">env fallback</Badge>
                      )}
                    </div>
                    {existing && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Created {new Date(existing.createdAt).toLocaleDateString()}
                        {existing.rotatedAt && ` · rotated ${new Date(existing.rotatedAt).toLocaleDateString()}`}
                        {existing.lastUsedAt
                          ? ` · last used ${new Date(existing.lastUsedAt).toLocaleString()}`
                          : ' · never used'}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button onClick={() => rotate(path)} disabled={busy === path}>
                      {existing ? 'Rotate' : 'Generate'}
                    </Button>
                    {existing && existing.isActive && (
                      <Button
                        variant="outline"
                        onClick={() => revoke(existing)}
                        disabled={busy === existing.id}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
