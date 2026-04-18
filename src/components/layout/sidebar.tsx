'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/theme-provider'
import { useT } from '@/components/i18n-provider'
import { LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n'

const navItems = [
  { href: '/dashboard', key: 'nav.dashboard', icon: '📊' },
  { href: '/campaigns', key: 'nav.campaigns',  icon: '🎯' },
  { href: '/seedance2', key: 'nav.seedance2',  icon: '🎬' },
  { href: '/assets',    key: 'nav.assets',     icon: '📂' },
  { href: '/creatives', key: 'nav.creatives',  icon: '🎨' },
  { href: '/budget',    key: 'nav.budget',     icon: '💰' },
  { href: '/advisor',   key: 'nav.advisor',    icon: '🤖' },
  { href: '/settings',  key: 'nav.settings',   icon: '⚙️' },
]

export function Sidebar({ userName }: { userName?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const { resolvedTheme, toggle } = useTheme()
  const { t, locale, setLocale } = useT()

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
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
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
            {t(item.key)}
          </Link>
        ))}
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
