'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

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

export function Sidebar() {
  const pathname = usePathname()

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
      <div className="px-4 py-4 border-t border-gray-800">
        <button className="w-full text-left text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors">
          Logout
        </button>
      </div>
    </aside>
  )
}
