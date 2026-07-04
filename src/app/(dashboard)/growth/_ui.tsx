'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn, api } from '@/lib/utils'

/** Percent formatter shared across the growth pages. */
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`

export const CHANNEL_LABEL: Record<string, string> = {
  paid_meta_web: 'Meta → web',
  paid_tiktok_web: 'TikTok → web',
  paid_asa: 'Apple Search Ads',
  paid_meta_ios: 'Meta iOS (SKAN)',
  paid_tiktok_ios: 'TikTok iOS (SKAN)',
  paid_google_uac: 'Google UAC',
  kol: 'KOL',
  referral: 'Referral',
  organic: 'Organic',
  seo: 'SEO',
  aso: 'ASO',
}
export const channelLabel = (c: string) => CHANNEL_LABEL[c] ?? c

const TABS = [
  { href: '/growth', label: 'Overview' },
  { href: '/growth/channels', label: 'Channels' },
  { href: '/growth/cohorts', label: 'Cohorts' },
  { href: '/growth/creators', label: 'Creators' },
  { href: '/growth/reviews', label: 'Reviews' },
]

export function GrowthTabs() {
  const pathname = usePathname()
  return (
    <div className="flex gap-1 border-b border-line -mb-px overflow-x-auto">
      {TABS.map((t) => {
        const active = pathname === api(t.href) || pathname === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
              active
                ? 'border-signal text-signal'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}

/** loopback agent heartbeat strip — the terminal `live●` signature. */
export function AgentPulse({ note }: { note?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono text-dim">
      <span className="lb-live" />
      <span>agent · growth-sync nightly · 127.0.0.1 :: ready{note ? ` · ${note}` : ''}</span>
    </div>
  )
}

/** loopback-styled gate chip: scale=ok, halve/kill/freeze=warn/bad, else muted. */
export function GateBadge({ decision }: { decision: string }) {
  const map: Record<string, string> = {
    scale: 'bg-ok/10 text-ok border border-ok/25',
    continue: 'bg-mut/10 text-mut border border-line',
    halve: 'bg-warn/10 text-warn border border-warn/25',
    kill: 'bg-bad/10 text-bad border border-bad/25',
    freeze_scaling: 'bg-bad/10 text-bad border border-bad/25',
    insufficient_data: 'bg-mut/10 text-dim border border-line',
  }
  const label: Record<string, string> = {
    scale: 'scale',
    continue: 'hold',
    halve: 'halve',
    kill: 'kill',
    freeze_scaling: 'freeze',
    insufficient_data: 'pending',
  }
  return (
    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-[11px] font-mono font-medium', map[decision] ?? map.insufficient_data)}>
      {label[decision] ?? decision}
    </span>
  )
}
