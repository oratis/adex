'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn, api } from '@/lib/utils'
import { useTheme } from '@/components/theme-provider'
import { useT } from '@/components/i18n-provider'
import { LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n'

const navItems = [
  { href: '/dashboard',  key: 'nav.dashboard',  icon: '📊' },
  { href: '/campaigns',  key: 'nav.campaigns',  icon: '🎯' },
  { href: '/seedance2',  key: 'nav.seedance2',  icon: '🎬' },
  { href: '/assets',     key: 'nav.assets',     icon: '📂' },
  { href: '/creatives',  key: 'nav.creatives',  icon: '🎨' },
  { href: '/budget',     key: 'nav.budget',     icon: '💰' },
  { href: '/advisor',    key: 'nav.advisor',    icon: '🤖' },
  { href: '/decisions',  key: 'nav.decisions',  icon: '🧠', fallback: 'Decisions' },
  { href: '/approvals',  key: 'nav.approvals',  icon: '🛂', fallback: 'Approvals' },
  { href: '/guardrails', key: 'nav.guardrails', icon: '🚧', fallback: 'Guardrails' },
  { href: '/experiments', key: 'nav.experiments', icon: '🧪', fallback: 'Experiments' },
  { href: '/prompts',    key: 'nav.prompts',    icon: '📝', fallback: 'Prompts' },
  { href: '/agent-cost', key: 'nav.agent_cost', icon: '💵', fallback: 'LLM cost' },
  { href: '/agent-onboarding', key: 'nav.agent_onboarding', icon: '🚀', fallback: 'Onboarding' },
  { href: '/webhooks',   key: 'nav.webhooks',   icon: '📡', fallback: 'Webhooks' },
  { href: '/creatives/review', key: 'nav.creative_review', icon: '🖼️', fallback: 'Creative review' },
  { href: '/settings',   key: 'nav.settings',   icon: '⚙️' },
]

type Org = { id: string; name: string; role: string; isActive: boolean }

export function Sidebar({
  userName,
  orgName,
  orgRole,
}: {
  userName?: string
  orgName?: string
  orgRole?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const [orgs, setOrgs] = useState<Org[]>([])
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const { resolvedTheme, toggle } = useTheme()
  const { t, locale, setLocale } = useT()

  useEffect(() => {
    loadOrgs()
  }, [])

  async function loadOrgs() {
    try {
      const res = await fetch(api('/api/orgs'))
      const data = await res.json()
      if (Array.isArray(data)) setOrgs(data)
    } catch {
      // silent
    }
  }

  async function switchOrg(orgId: string) {
    try {
      await fetch(api('/api/orgs/switch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      setOrgMenuOpen(false)
      // Full reload so server components re-resolve with new active org
      window.location.reload()
    } catch {
      // silent
    }
  }

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore — we'll still redirect
    } finally {
      router.push('/login')
      router.refresh()
    }
  }

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="px-6 py-5 border-b border-gray-800">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-blue-400">Ad</span>ex
        </h1>
        <p className="text-xs text-gray-400 mt-1">Automated Ad Agent</p>
      </div>

      {orgName && (
        <div className="px-4 py-3 border-b border-gray-800 relative">
          <button
            onClick={() => setOrgMenuOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500">{t('workspace.label')}</p>
              <p className="text-sm font-medium truncate" title={orgName}>
                {orgName}
              </p>
              {orgRole && (
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">
                  {orgRole}
                </p>
              )}
            </div>
            <span className="text-gray-400 text-xs">{orgMenuOpen ? '▴' : '▾'}</span>
          </button>

          {orgMenuOpen && (
            <div className="absolute left-2 right-2 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                {orgs.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => switchOrg(o.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors flex items-center justify-between',
                      o.isActive && 'bg-blue-600/20 text-blue-300'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{o.name}</p>
                      <p className="text-[10px] text-gray-500 uppercase">{o.role}</p>
                    </div>
                    {o.isActive && <span className="text-xs">✓</span>}
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-700">
                <Link
                  href="/settings?tab=members"
                  onClick={() => setOrgMenuOpen(false)}
                  className="block px-3 py-2 text-sm text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
                >
                  {t('workspace.manage_members')}
                </Link>
                <Link
                  href="/settings?tab=members&new=1"
                  onClick={() => setOrgMenuOpen(false)}
                  className="block px-3 py-2 text-sm text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
                >
                  {t('workspace.create_new')}
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const label = t(item.key)
          // i18n keys not yet translated come back as the raw key — fall back
          // to a hard-coded English label when present (sidebar nav additions
          // shouldn't have to wait on localization to be usable).
          const text = label === item.key && 'fallback' in item ? (item as { fallback?: string }).fallback || label : label
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                pathname.startsWith(item.href)
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              )}
            >
              <span className="text-lg">{item.icon}</span>
              {text}
            </Link>
          )
        })}
      </nav>
      <div className="px-4 py-4 border-t border-gray-800 space-y-2">
        {userName && (
          <div className="px-3 text-xs text-gray-500 truncate" title={userName}>
            {t('nav.signed_in_as')} <span className="text-gray-300">{userName}</span>
          </div>
        )}
        <div className="flex gap-1 px-3">
          {LOCALES.map((l: Locale) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={cn(
                'text-xs px-2 py-1 rounded transition-colors',
                locale === l
                  ? 'bg-blue-600/20 text-blue-300'
                  : 'text-gray-500 hover:text-white hover:bg-gray-800'
              )}
              aria-label={`Switch to ${LOCALE_LABELS[l]}`}
            >
              {LOCALE_LABELS[l]}
            </button>
          ))}
        </div>
        <button
          onClick={toggle}
          className="w-full text-left text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
          aria-label="Toggle theme"
        >
          <span>{resolvedTheme === 'dark' ? '☀️' : '🌙'}</span>
          <span>{resolvedTheme === 'dark' ? t('nav.light_mode') : t('nav.dark_mode')}</span>
        </button>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full text-left text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {loggingOut ? t('nav.logging_out') : t('nav.logout')}
        </button>
      </div>
    </aside>
  )
}
