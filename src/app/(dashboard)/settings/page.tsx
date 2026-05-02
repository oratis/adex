'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { MembersPanel } from '@/components/members-panel'
import { AuditPanel } from '@/components/audit-panel'
import { SessionsPanel } from '@/components/sessions-panel'
import { WebhooksPanel } from '@/components/webhooks-panel'
import { api } from '@/lib/utils'

interface PlatformAuth {
  id: string
  platform: string
  accountId: string | null
  appId: string | null
  apiKey: string | null
  isActive: boolean
  extra: string | null
  hasRefreshToken?: boolean
  hasAccessToken?: boolean
}

interface PlatformConfig {
  id: string
  name: string
  icon: string
  description: string
  oauthSupported?: boolean
  fields: Array<{ key: string; label: string; placeholder: string; sensitive?: boolean }>
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: 'google', name: 'Google Ads', icon: '🔵',
    description: 'Connect your Google Ads MCC or individual account',
    oauthSupported: true,
    fields: [
      { key: 'accountId', label: 'MCC / Customer ID', placeholder: '830-379-6268' },
      { key: 'apiKey', label: 'Developer Token', placeholder: 'Google Ads developer token', sensitive: true },
    ],
  },
  {
    id: 'meta', name: 'Meta (Facebook)', icon: '🟣',
    description: 'Connect Facebook/Instagram ad accounts',
    fields: [
      { key: 'accountId', label: 'Ad Account ID', placeholder: 'act_xxxxxxxxx' },
      { key: 'accessToken', label: 'Access Token', placeholder: 'Facebook access token', sensitive: true },
      { key: 'appId', label: 'App ID (optional)', placeholder: 'Facebook App ID' },
      { key: 'appSecret', label: 'App Secret (optional)', placeholder: 'Facebook App Secret', sensitive: true },
    ],
  },
  {
    id: 'tiktok', name: 'TikTok Ads', icon: '⬛',
    description: 'Connect TikTok Business ad accounts',
    fields: [
      { key: 'accountId', label: 'Advertiser ID', placeholder: 'TikTok Advertiser ID' },
      { key: 'accessToken', label: 'Access Token', placeholder: 'TikTok access token', sensitive: true },
      { key: 'appId', label: 'App ID (optional)', placeholder: 'TikTok App ID' },
      { key: 'appSecret', label: 'App Secret (optional)', placeholder: 'TikTok App Secret', sensitive: true },
    ],
  },
  {
    id: 'appsflyer', name: 'AppsFlyer', icon: '📱',
    description: 'Connect AppsFlyer for attribution data',
    fields: [
      { key: 'apiKey', label: 'API Token', placeholder: 'AppsFlyer API token', sensitive: true },
      { key: 'appId', label: 'App ID', placeholder: 'com.example.app' },
    ],
  },
  {
    id: 'adjust', name: 'Adjust', icon: '📐',
    description: 'Connect Adjust for attribution data',
    fields: [
      { key: 'apiKey', label: 'API Token', placeholder: 'Adjust API token', sensitive: true },
      { key: 'appId', label: 'App Token', placeholder: 'Adjust app token' },
    ],
  },
  {
    id: 'amazon', name: 'Amazon Ads', icon: '🟠',
    description: 'Connect Amazon Advertising (Sponsored Products, Brands, Display)',
    fields: [
      { key: 'accountId', label: 'Profile ID', placeholder: 'Amazon Advertising profile ID' },
      { key: 'appId', label: 'LWA Client ID', placeholder: 'amzn1.application-oa2-client.xxx' },
      { key: 'appSecret', label: 'LWA Client Secret', placeholder: 'LWA client secret', sensitive: true },
      { key: 'accessToken', label: 'Access Token', placeholder: 'LWA access token', sensitive: true },
      { key: 'refreshToken', label: 'Refresh Token', placeholder: 'LWA refresh token (for auto-refresh)', sensitive: true },
    ],
  },
  {
    id: 'linkedin', name: 'LinkedIn Ads', icon: '🔷',
    description: 'Connect LinkedIn Marketing Solutions',
    fields: [
      { key: 'accountId', label: 'Ad Account ID', placeholder: 'numeric id (e.g. 12345678)' },
      { key: 'accessToken', label: 'Access Token', placeholder: 'OAuth access token', sensitive: true },
      { key: 'appId', label: 'Client ID (optional)', placeholder: 'for auto-refresh' },
      { key: 'appSecret', label: 'Client Secret (optional)', placeholder: 'for auto-refresh', sensitive: true },
      { key: 'refreshToken', label: 'Refresh Token (optional)', placeholder: 'for auto-refresh', sensitive: true },
    ],
  },
  {
    id: 'seedream', name: 'Seedream (Image AI)', icon: '🎨',
    description: 'AI image generation for ad creatives',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Seedream API key', sensitive: true },
    ],
  },
  {
    id: 'seedance', name: 'Seedance (Video AI)', icon: '🎬',
    description: 'AI video generation for ad creatives',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Seedance API key', sensitive: true },
    ],
  },
]

export default function SettingsPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  const [auths, setAuths] = useState<PlatformAuth[]>([])
  // Account management
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [deleteForm, setDeleteForm] = useState({ password: '', confirm: '' })
  const [deleting, setDeleting] = useState(false)
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [profile, setProfile] = useState({ name: '', dailyReportEmail: '', timezone: 'UTC' })
  const [savingProfile, setSavingProfile] = useState(false)
  const [googleAccounts, setGoogleAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)

  const loadAuths = useCallback(async () => {
    const res = await fetch(api('/api/platforms'))
    const data = await res.json()
    if (!Array.isArray(data)) return

    setAuths(data)

    // Pre-populate form fields with saved values
    const newFormData: Record<string, Record<string, string>> = {}
    for (const auth of data) {
      newFormData[auth.platform] = {}
      if (auth.accountId) newFormData[auth.platform].accountId = auth.accountId
      if (auth.appId) newFormData[auth.platform].appId = auth.appId
      if (auth.apiKey) newFormData[auth.platform].apiKey = auth.apiKey
    }
    setFormData(prev => {
      // Merge: keep any user-edited values, fill in saved values for empty fields
      const merged: Record<string, Record<string, string>> = { ...newFormData }
      for (const [platform, fields] of Object.entries(prev)) {
        if (!merged[platform]) merged[platform] = {}
        for (const [key, val] of Object.entries(fields)) {
          if (val) merged[platform][key] = val  // user-edited values take precedence
        }
      }
      return merged
    })
  }, [])

  useEffect(() => {
    loadAuths()
    fetch(api('/api/auth/me')).then(r => r.json()).then(data => {
      if (data.name !== undefined) setProfile({ name: data.name || '', dailyReportEmail: data.dailyReportEmail || '', timezone: data.timezone || 'UTC' })
    })

    // Check for OAuth callback results
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === 'google_connected') {
      window.history.replaceState({}, '', window.location.pathname)
      loadAuths()
    }
    if (params.get('error')) {
      setTestError(`Google OAuth error: ${params.get('error')}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [loadAuths])

  function startGoogleOAuth() {
    window.location.href = api('/api/auth/google')
  }

  async function savePlatform(platformId: string) {
    setSaving(platformId)
    setTestError(null)
    try {
      const data = formData[platformId] || {}
      const res = await fetch(api('/api/platforms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformId, ...data }),
      })
      const result = await res.json()
      if (result.error) {
        setTestError(result.error)
        toast({ variant: 'error', title: 'Save failed', description: result.error })
      } else {
        toast({ variant: 'success', title: `${platformId} connection saved` })
        // Reload to get updated saved values
        await loadAuths()
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Save failed', description: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(null)
    }
  }

  async function removePlatform(platformId: string) {
    if (
      !(await confirm({
        title: 'Disconnect platform',
        message: `Remove ${platformId} authorization?`,
        confirmLabel: 'Disconnect',
        variant: 'danger',
      }))
    )
      return
    try {
      const res = await fetch(api('/api/platforms'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformId }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Remove failed')
      setFormData(prev => ({ ...prev, [platformId]: {} }))
      setGoogleAccounts([])
      setTestError(null)
      await loadAuths()
      toast({ variant: 'success', title: `${platformId} disconnected` })
    } catch (err) {
      toast({ variant: 'error', title: 'Remove failed', description: err instanceof Error ? err.message : undefined })
    }
  }

  async function testGoogleConnection() {
    setLoadingAccounts(true)
    setTestError(null)
    try {
      const res = await fetch(api('/api/google-ads/accounts'))
      const data = await res.json()
      if (data.error) {
        setTestError(data.error)
        if (data.hint) setTestError(prev => `${prev}\n${data.hint}`)
      } else {
        setGoogleAccounts(data.accounts || [])
        if (data.accounts?.length === 0) {
          setTestError('Connected but no accessible accounts found. Check MCC ID and Developer Token.')
        }
      }
    } catch {
      setTestError('Failed to connect to Google Ads API')
    } finally {
      setLoadingAccounts(false)
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const res = await fetch(api('/api/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      toast({ variant: 'success', title: 'Profile saved' })
    } catch (err) {
      toast({ variant: 'error', title: 'Save failed', description: err instanceof Error ? err.message : undefined })
    } finally {
      setSavingProfile(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (pwForm.next !== pwForm.confirm) {
      toast({ variant: 'error', title: 'Passwords do not match' })
      return
    }
    if (pwForm.next.length < 8) {
      toast({ variant: 'error', title: 'New password must be at least 8 characters' })
      return
    }
    setPwSaving(true)
    try {
      const res = await fetch(api('/api/auth/change-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: pwForm.current,
          newPassword: pwForm.next,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Change failed')
      toast({ variant: 'success', title: 'Password changed' })
      setPwForm({ current: '', next: '', confirm: '' })
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Change failed',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setPwSaving(false)
    }
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault()
    if (deleteForm.confirm !== 'DELETE') {
      toast({ variant: 'error', title: 'Type DELETE to confirm' })
      return
    }
    if (
      !(await confirm({
        title: 'Delete account permanently',
        message: 'This will permanently delete your account and ALL data. Continue?',
        confirmLabel: 'Delete account',
        variant: 'danger',
      }))
    )
      return
    setDeleting(true)
    try {
      const res = await fetch(api('/api/auth/delete-account'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: deleteForm.password,
          confirm: deleteForm.confirm,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      toast({ variant: 'success', title: 'Account deleted' })
      router.push('/login')
      router.refresh()
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Delete failed',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setDeleting(false)
    }
  }

  function getFieldValue(platformId: string, fieldKey: string) {
    return formData[platformId]?.[fieldKey] || ''
  }

  function setFieldValue(platformId: string, fieldKey: string, value: string) {
    setFormData(prev => ({
      ...prev,
      [platformId]: { ...prev[platformId], [fieldKey]: value },
    }))
  }

  const googleAuth = auths.find(a => a.platform === 'google')
  const hasGoogleOAuth = googleAuth?.hasRefreshToken || false

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Configure platform authorizations and account settings</p>
      </div>

      <Tabs tabs={[
        {
          id: 'platforms',
          label: 'Platform Auth',
          content: (
            <div className="space-y-4">
              {PLATFORMS.map((p) => {
                const auth = auths.find(a => a.platform === p.id)
                return (
                  <Card key={p.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{p.icon}</span>
                          <div>
                            <CardTitle className="text-base">{p.name}</CardTitle>
                            <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
                          </div>
                        </div>
                        {auth?.isActive ? (
                          <Badge variant="success">Connected</Badge>
                        ) : (
                          <Badge variant="default">Not Connected</Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {/* Google Ads: OAuth flow */}
                      {p.id === 'google' && (
                        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                          <p className="text-sm font-medium text-blue-800 mb-1">Step 1: Authorize with Google</p>
                          <p className="text-xs text-blue-600 mb-3">
                            Authorize Adex to access Google Ads data. Use the account with MCC access.
                          </p>
                          <div className="flex items-center gap-3">
                            <Button size="sm" variant="outline" onClick={startGoogleOAuth}>
                              {hasGoogleOAuth ? '🔄 Re-authorize' : '🔗 Authorize with Google'}
                            </Button>
                            {hasGoogleOAuth && (
                              <span className="text-xs text-green-600 font-medium">✓ OAuth token obtained</span>
                            )}
                          </div>
                        </div>
                      )}

                      {p.id === 'google' && (
                        <div className="mb-3 p-3 bg-gray-50 rounded-lg border">
                          <p className="text-sm font-medium mb-0.5">Step 2: Enter MCC Info & Save</p>
                          <p className="text-xs text-gray-500">
                            Fill in both fields below and click Save. The MCC ID allows managing all sub-accounts.
                          </p>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {p.fields.map((f) => (
                          <div key={f.key}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {f.label}
                              {getFieldValue(p.id, f.key) && auth?.isActive && (
                                <span className="text-green-600 text-xs ml-2">✓ saved</span>
                              )}
                            </label>
                            <Input
                              type={f.sensitive ? 'password' : 'text'}
                              placeholder={f.placeholder}
                              value={getFieldValue(p.id, f.key)}
                              onChange={(e) => setFieldValue(p.id, f.key, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>

                      {/* Error display */}
                      {p.id === 'google' && testError && (
                        <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                          <p className="text-sm text-red-700 whitespace-pre-line">{testError}</p>
                        </div>
                      )}

                      <div className="flex gap-2 mt-4">
                        <Button size="sm" onClick={() => savePlatform(p.id)} disabled={saving === p.id}>
                          {saving === p.id ? 'Saving...' : 'Save'}
                        </Button>
                        {p.id === 'google' && hasGoogleOAuth && (
                          <Button size="sm" variant="outline" onClick={testGoogleConnection} disabled={loadingAccounts}>
                            {loadingAccounts ? 'Testing...' : 'Test & List Accounts'}
                          </Button>
                        )}
                        {auth && (
                          <Button size="sm" variant="danger" onClick={() => removePlatform(p.id)}>
                            Disconnect
                          </Button>
                        )}
                      </div>

                      {/* Google accounts list */}
                      {p.id === 'google' && googleAccounts.length > 0 && (
                        <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                          <p className="text-sm font-medium text-green-800 mb-2">
                            ✓ Accessible Accounts ({googleAccounts.length})
                          </p>
                          <div className="space-y-1">
                            {googleAccounts.map((acc) => (
                              <div key={acc.id} className="flex items-center gap-2 text-sm">
                                <span className="text-green-600">✓</span>
                                <span className="font-mono text-xs">{acc.id}</span>
                                <span className="text-gray-600">{acc.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          ),
        },
        {
          id: 'profile',
          label: 'Profile & Notifications',
          content: (
            <Card>
              <CardHeader>
                <CardTitle>Profile Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={saveProfile} className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-sm font-medium mb-1">Display Name</label>
                    <Input value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Daily Report Email · 每日报告邮箱</label>
                    <Input
                      type="email"
                      value={profile.dailyReportEmail}
                      onChange={e => setProfile(p => ({ ...p, dailyReportEmail: e.target.value }))}
                      placeholder="Receive daily performance reports at this email"
                    />
                    <p className="text-xs text-gray-500 mt-1">Leave empty to disable daily reports.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Timezone · 时区</label>
                    <select
                      value={profile.timezone}
                      onChange={e => setProfile(p => ({ ...p, timezone: e.target.value }))}
                      className="block w-full border rounded px-2 py-2"
                    >
                      <option value="UTC">UTC (协调世界时)</option>
                      <option value="Asia/Shanghai">Asia/Shanghai · 北京时间</option>
                      <option value="Asia/Tokyo">Asia/Tokyo · 东京</option>
                      <option value="Asia/Singapore">Asia/Singapore · 新加坡</option>
                      <option value="Asia/Kolkata">Asia/Kolkata · 印度</option>
                      <option value="Europe/London">Europe/London · 伦敦</option>
                      <option value="Europe/Paris">Europe/Paris · 巴黎</option>
                      <option value="Europe/Berlin">Europe/Berlin · 柏林</option>
                      <option value="America/New_York">America/New_York · 纽约</option>
                      <option value="America/Chicago">America/Chicago · 芝加哥</option>
                      <option value="America/Denver">America/Denver · 丹佛</option>
                      <option value="America/Los_Angeles">America/Los_Angeles · 洛杉矶</option>
                      <option value="Australia/Sydney">Australia/Sydney · 悉尼</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Used for displaying timestamps + the agent_active_hours guardrail.
                      <br />
                      时间戳显示 + agent_active_hours 规则按这个时区。
                    </p>
                  </div>
                  <Button type="submit" disabled={savingProfile}>
                    {savingProfile ? 'Saving...' : 'Save Settings'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ),
        },
        {
          id: 'members',
          label: 'Team',
          content: <MembersPanel />,
        },
        {
          id: 'audit',
          label: 'Audit Log',
          content: <AuditPanel />,
        },
        {
          id: 'webhooks',
          label: 'Webhooks',
          content: <WebhooksPanel />,
        },
        {
          id: 'account',
          label: 'Account',
          content: (
            <div className="space-y-4">
              <SessionsPanel />
              <Card>
                <CardHeader><CardTitle>Change Password</CardTitle></CardHeader>
                <CardContent>
                  <form onSubmit={changePassword} className="space-y-4 max-w-md">
                    <div>
                      <label className="block text-sm font-medium mb-1">Current password</label>
                      <Input
                        type="password"
                        value={pwForm.current}
                        onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                        required
                        autoComplete="current-password"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">New password</label>
                      <Input
                        type="password"
                        value={pwForm.next}
                        onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Confirm new password</label>
                      <Input
                        type="password"
                        value={pwForm.confirm}
                        onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                        required
                        minLength={8}
                        autoComplete="new-password"
                      />
                    </div>
                    <Button type="submit" disabled={pwSaving}>
                      {pwSaving ? 'Changing...' : 'Change Password'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-red-600">Danger Zone</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={deleteAccount} className="space-y-4 max-w-md">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                      Deleting your account is <strong>permanent</strong>. All campaigns,
                      creatives, budgets, reports, and platform connections will be removed.
                      Uploaded assets remain in shared storage and must be cleared separately.
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Current password</label>
                      <Input
                        type="password"
                        value={deleteForm.password}
                        onChange={e => setDeleteForm(f => ({ ...f, password: e.target.value }))}
                        required
                        autoComplete="current-password"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Type <code className="bg-gray-100 px-1 rounded">DELETE</code> to confirm
                      </label>
                      <Input
                        value={deleteForm.confirm}
                        onChange={e => setDeleteForm(f => ({ ...f, confirm: e.target.value }))}
                        placeholder="DELETE"
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="danger"
                      disabled={deleting || deleteForm.confirm !== 'DELETE'}
                    >
                      {deleting ? 'Deleting...' : 'Delete Account Permanently'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          ),
        },
      ]} />
    </div>
  )
}
