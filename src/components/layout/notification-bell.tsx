'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/utils'

type Summary = {
  pendingApprovals: number
  expiringApprovals: number
  driftedCampaigns: number
  pendingCreatives: number
  abandonedDeliveries: number
  freshFailures: number
  platformAdminInvitesUnused: number
  total: number
}

const POLL_MS = 60_000

export function NotificationBell() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchOnce() {
      try {
        const r = await fetch(api('/api/notifications/summary'))
        if (!r.ok) return
        const data = (await r.json()) as Summary
        if (!cancelled) setSummary(data)
      } catch {
        /* swallow */
      }
    }
    fetchOnce()
    const id = setInterval(fetchOnce, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const total = summary?.total ?? 0
  const expiring = summary?.expiringApprovals ?? 0

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        aria-label="Notifications"
        title="Notifications"
      >
        <span className="text-lg">🔔</span>
        {total > 0 && (
          <span
            className={
              'absolute top-1 right-1 min-w-[16px] h-[16px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 ' +
              (expiring > 0 ? 'bg-rose-500 text-white' : 'bg-blue-500 text-white')
            }
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white text-gray-900 rounded-lg shadow-xl border z-30 overflow-hidden">
          <div className="px-3 py-2 border-b text-xs uppercase text-gray-500">
            Notifications · 待办
          </div>
          {summary ? (
            <ul className="divide-y text-sm">
              <NotifRow
                count={summary.pendingApprovals}
                label="Pending approvals · 待审批"
                urgent={summary.expiringApprovals > 0}
                hint={summary.expiringApprovals > 0 ? `${summary.expiringApprovals} expiring < 12h` : undefined}
                href="/approvals"
              />
              <NotifRow
                count={summary.driftedCampaigns}
                label="Drifted campaigns · 平台状态不一致"
                href="/campaigns"
              />
              <NotifRow
                count={summary.pendingCreatives}
                label="Creatives awaiting review · 创意待审"
                href="/creatives/review?status=pending"
              />
              <NotifRow
                count={summary.abandonedDeliveries}
                label="Abandoned webhook deliveries · 投递失败"
                href="/webhooks?status=abandoned"
              />
              <NotifRow
                count={summary.freshFailures}
                label="Failed agent decisions · 失败的决策"
                href="/decisions?status=failed"
              />
              {summary.platformAdminInvitesUnused > 0 && (
                <NotifRow
                  count={summary.platformAdminInvitesUnused}
                  label="Unused invite codes · 未使用邀请码"
                  href="/admin/invites?status=unused"
                />
              )}
              {total === 0 && (
                <li className="px-3 py-4 text-center text-gray-500 text-xs">
                  All clear · 全部处理完了 ✨
                </li>
              )}
            </ul>
          ) : (
            <div className="px-3 py-4 text-center text-gray-400 text-xs">Loading…</div>
          )}
        </div>
      )}
    </div>
  )
}

function NotifRow({
  count,
  label,
  href,
  urgent,
  hint,
}: {
  count: number
  label: string
  href: string
  urgent?: boolean
  hint?: string
}) {
  if (count === 0) return null
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors"
      >
        <span
          className={
            'min-w-[20px] h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center px-1.5 ' +
            (urgent ? 'bg-rose-500' : 'bg-blue-500')
          }
        >
          {count}
        </span>
        <span className="flex-1 truncate">{label}</span>
        {hint && <span className="text-[10px] text-rose-700 whitespace-nowrap">{hint}</span>}
      </Link>
    </li>
  )
}
