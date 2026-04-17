'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/theme-provider'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/campaigns', label: 'Campaigns', icon: '🎯' },
  { href: '/seedance2', label: 'Seedance2', icon: '🎬' },
  { href: '/assets', label: 'Asset Library', icon: '📂' },
  { href: '/creatives', label: 'Creatives', icon: '🎨' },
  { href: '/budget', label: 'Budget', icon: '💰' },
  { href: '/advisor', label: 'AI Advisor', icon: '🤖' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
]

export function Sidebar({ userName }: { userName?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const { resolvedTheme, toggle } = useTheme()

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
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="px-4 py-4 border-t border-gray-800 space-y-2">
        {userName && (
          <div className="px-3 text-xs text-gray-500 truncate" title={userName}>
            Signed in as <span className="text-gray-300">{userName}</span>
          </div>
        )}
        <button
          onClick={toggle}
          className="w-full text-left text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
          aria-label="Toggle theme"
        >
          <span>{resolvedTheme === 'dark' ? '☀️' : '🌙'}</span>
          <span>{resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full text-left text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {loggingOut ? 'Signing out…' : 'Logout'}
        </button>
      </div>
    </aside>
  )
}
