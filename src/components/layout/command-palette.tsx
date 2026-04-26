'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Cmd+K (or Ctrl+K) global command palette. Hard-codes the page list since
 * sitemap is small + stable; campaigns / decisions / orgs lookup is left
 * out for now (deferred — would need indexed search). Type to filter,
 * Enter to navigate.
 */

type Command = {
  label: string
  zhLabel: string
  href: string
  keywords?: string[]
}

const COMMANDS: Command[] = [
  { label: 'Dashboard', zhLabel: '仪表盘', href: '/dashboard', keywords: ['home', 'overview'] },
  { label: 'Campaigns', zhLabel: '广告系列', href: '/campaigns', keywords: ['ads', 'campaigns'] },
  { label: 'Creatives', zhLabel: '创意库', href: '/creatives' },
  { label: 'Creative review', zhLabel: '创意审核', href: '/creatives/review?status=pending' },
  { label: 'Asset library', zhLabel: '素材库', href: '/assets' },
  { label: 'Seedance video gen', zhLabel: 'Seedance 视频生成', href: '/seedance2' },
  { label: 'Budget', zhLabel: '预算', href: '/budget' },
  { label: 'AI Advisor', zhLabel: 'AI 顾问', href: '/advisor' },
  { label: 'Decisions', zhLabel: 'Agent 决策', href: '/decisions' },
  { label: 'Approvals', zhLabel: '待审批', href: '/approvals' },
  { label: 'Guardrails', zhLabel: '安全规则', href: '/guardrails' },
  { label: 'Experiments', zhLabel: 'A/B 实验', href: '/experiments' },
  { label: 'Prompts', zhLabel: 'Prompt 版本', href: '/prompts' },
  { label: 'LLM cost', zhLabel: 'LLM 成本', href: '/agent-cost' },
  { label: 'Agent stats', zhLabel: 'Agent 统计', href: '/agent-stats' },
  { label: 'Agent onboarding', zhLabel: 'Agent 上手', href: '/agent-onboarding' },
  { label: 'Webhooks', zhLabel: '回调投递', href: '/webhooks' },
  { label: 'Orphan campaigns', zhLabel: '孤儿广告系列', href: '/orphans' },
  { label: 'Audit log', zhLabel: '审计日志', href: '/audit' },
  { label: 'Settings', zhLabel: '设置', href: '/settings' },
  { label: 'Setup wizard', zhLabel: '上手向导', href: '/setup' },
  // Admin
  { label: 'Admin · invite codes', zhLabel: '管理员 · 邀请码', href: '/admin/invites' },
  { label: 'Admin · users', zhLabel: '管理员 · 用户', href: '/admin/users' },
]

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const ctrl = isMac ? e.metaKey : e.ctrlKey
      if (ctrl && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setQuery('')
        setHighlight(0)
        return
      }
      if (open && e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COMMANDS.slice(0, 12)
    return COMMANDS.filter((c) => {
      if (c.label.toLowerCase().includes(q)) return true
      if (c.zhLabel.includes(query.trim())) return true
      if (c.href.toLowerCase().includes(q)) return true
      if (c.keywords?.some((k) => k.toLowerCase().includes(q))) return true
      return false
    }).slice(0, 12)
  }, [query])

  function go(c: Command) {
    setOpen(false)
    setQuery('')
    router.push(c.href)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const sel = matches[highlight]
      if (sel) go(sel)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Type to search · 输入搜索…"
          className="w-full px-4 py-3 text-base border-b focus:outline-none"
        />
        <ul className="max-h-80 overflow-y-auto">
          {matches.map((c, i) => (
            <li key={c.href}>
              <button
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(c)}
                className={
                  'w-full text-left px-4 py-2 flex items-center justify-between gap-3 ' +
                  (i === highlight ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50')
                }
              >
                <div>
                  <div className="text-sm font-medium">{c.zhLabel}</div>
                  <div className="text-xs text-gray-500">{c.label}</div>
                </div>
                <span className="text-xs text-gray-400 font-mono">{c.href}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-500">No matches</li>
          )}
        </ul>
        <div className="border-t px-4 py-2 text-[10px] text-gray-400 flex items-center gap-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto">⌘K · Ctrl+K</span>
        </div>
      </div>
    </div>
  )
}
