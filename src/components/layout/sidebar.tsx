'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn, api } from '@/lib/utils'
import { useTheme } from '@/components/theme-provider'
import { NotificationBell } from './notification-bell'
import { useT } from '@/components/i18n-provider'
import { LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n'

const navItems = [
  { href: '/dashboard',        key: 'nav.dashboard',        icon: '📊' },
  { href: '/campaigns',        key: 'nav.campaigns',        icon: '🎯' },
  { href: '/seedance2',        key: 'nav.seedance2',        icon: '🎬' },
  { href: '/assets',           key: 'nav.assets',           icon: '📂' },
  { href: '/creatives',        key: 'nav.creatives',        icon: '🎨' },
  { href: '/budget',           key: 'nav.budget',           icon: '💰' },
  { href: '/advisor',          key: 'nav.advisor',          icon: '🤖' },
  { href: '/decisions',        key: 'nav.decisions',        icon: '🧠' },
  { href: '/approvals',        key: 'nav.approvals',        icon: '🛂' },
  { href: '/guardrails',       key: 'nav.guardrails',       icon: '🚧' },
  { href: '/experiments',      key: 'nav.experiments',      icon: '🧪' },
  { href: '/prompts',          key: 'nav.prompts',          icon: '📝' },
  { href: '/agent-cost',       key: 'nav.agent_cost',       icon: '💵' },
  { href: '/agent-stats',      key: 'nav.agent_stats',      icon: '📈' },
  { href: '/agent-onboarding', key: 'nav.agent_onboarding', icon: '🚀' },
  { href: '/webhooks',         key: 'nav.webhooks',         icon: '📡' },
  { href: '/creatives/review', key: 'nav.creative_review',  icon: '🖼️' },
  { href: '/orphans',          key: 'nav.orphans',          icon: '👻' },
  { href: '/audit',            key: 'nav.audit',            icon: '📜' },
  { href: '/settings',         key: 'nav.settings',         icon: '⚙️' },
]

type Org = { id: string; name: string; role: string; isActive: boolean }

const adminItems = [
  { href: '/admin/invites', icon: '🎟️', key: 'nav.admin.invites' },
  { href: '/admin/users',   icon: '👥', key: 'nav.admin.users' },
  { href: '/admin/health',  icon: '🩺', key: 'nav.admin.health' },
  { href: '/admin/cron-secrets', icon: '🔑', key: 'nav.admin.cron_secrets' },
]

// Hard-coded English fallbacks for nav labels — used when a translation
// key isn't in the dictionary yet. Keeps sidebar functional during partial
// i18n rollouts.
const NAV_FALLBACK: Record<string, string> = {
  'nav.decisions': 'Decisions',
  'nav.approvals': 'Approvals',
  'nav.guardrails': 'Guardrails',
  'nav.experiments': 'Experiments',
  'nav.prompts': 'Prompts',
  'nav.agent_cost': 'LLM cost',
  'nav.agent_stats': 'Agent stats',
  'nav.agent_onboarding': 'Onboarding',
  'nav.webhooks': 'Webhooks',
  'nav.creative_review': 'Creative review',
  'nav.orphans': 'Orphan campaigns',
  'nav.audit': 'Audit log',
  'nav.admin.invites': 'Invite codes',
  'nav.admin.users': 'Users',
  'nav.admin.health': 'Platform health',
  'nav.admin.cron_secrets': 'Cron secrets',
}
function labelFallback(key: string): string {
  return NAV_FALLBACK[key] || key
}

export function Sidebar({
  userName,
  orgName,
  orgRole,
  isPlatformAdmin,
}: {
  userName?: string
  orgName?: string
  orgRole?: string
  isPlatformAdmin?: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
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
    <>
      {/* Mobile hamburger — only visible < md */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-30 p-2 bg-gray-900 text-white rounded-lg shadow-lg"
        aria-label="Open menu"
      >
        <span className="block w-5 h-0.5 bg-white mb-1.5" />
        <span className="block w-5 h-0.5 bg-white mb-1.5" />
        <span className="block w-5 h-0.5 bg-white" />
      </button>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-30"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          'bg-gray-900 text-white min-h-screen flex flex-col z-40',
          // Desktop: always visible, fixed width
          'md:w-64 md:relative md:translate-x-0',
          // Mobile: drawer that slides in from left
          'fixed inset-y-0 left-0 w-64 transition-transform',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
      <div className="px-6 py-5 border-b border-gray-800 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-blue-400">Ad</span>ex
        </h1>
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden text-gray-400 hover:text-white text-xl leading-none"
          aria-label="Close menu"
        >
          ×
        </button>
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
          const text = label === item.key ? labelFallback(item.key) : label
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

        {isPlatformAdmin && (
          <>
            <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-gray-500">
              Platform admin
            </div>
            {adminItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  pathname.startsWith(item.href)
                    ? 'bg-purple-600/20 text-purple-300'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                )}
              >
                <span className="text-lg">{item.icon}</span>
                {(() => {
                  const lbl = t(item.key)
                  return lbl === item.key ? labelFallback(item.key) : lbl
                })()}
              </Link>
            ))}
          </>
        )}
      </nav>
      <div className="px-4 py-4 border-t border-gray-800 space-y-2">
        {userName && (
          <div className="px-3 text-xs text-gray-500 truncate" title={userName}>
            {t('nav.signed_in_as')} <span className="text-gray-300">{userName}</span>
          </div>
        )}
        <div className="px-3 flex justify-end">
          <NotificationBell />
        </div>
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
    </>
  )
}
