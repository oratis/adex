'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface FilterOption {
  value: string
  label: string
}

interface MultiSelectProps {
  label: string
  options: FilterOption[]
  /** Empty array means "全部" (no filter applied). */
  selected: string[]
  onChange: (next: string[]) => void
  className?: string
}

/**
 * Checkbox-list dropdown styled like ui/select.tsx's border/focus treatment.
 * Selection state: [] == "全部" (all). Trigger label shows "全部" or "N selected".
 */
export function MultiSelect({ label, options, selected, onChange, className }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const summary = selected.length === 0 ? '全部' : `已选 ${selected.length}`

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <span className="text-gray-500">{label}:</span>
        <span className="font-medium">{summary}</span>
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 min-w-[10rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {options.length === 0 ? (
            <p className="px-3 py-1.5 text-xs text-gray-400">无可选项</p>
          ) : (
            options.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                {o.label}
              </label>
            ))
          )}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full border-t px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-50"
            >
              清除
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface SingleSelectProps {
  label: string
  options: FilterOption[]
  /** null/'' means "全部" (no filter applied). */
  value: string | null
  onChange: (next: string | null) => void
  className?: string
}

/** Native <select> for mutually-exclusive filters (e.g. OS, paid/organic) where the API only takes one value. */
export function SingleSelect({ label, options, value, onChange, className }: SingleSelectProps) {
  return (
    <label className={cn('flex items-center gap-1.5 text-sm', className)}>
      <span className="text-gray-500">{label}:</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">全部</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

/** Thin flex-wrap row — just layout, the individual selects carry their own logic. */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>
}
