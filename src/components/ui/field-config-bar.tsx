'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { mergeFieldConfig, toggleFieldVisibility, reorderFields, visibleKeys, type FieldToggle } from '@/lib/dashboard-bi'

export interface FieldOption {
  key: string
  label: string
}

interface FieldConfigBarProps {
  /** localStorage key this bar's column order/visibility persists under — include the page name, e.g. "adex.dashboard.summary.columns". */
  storageKey: string
  /** Always-shown columns, rendered as static (non-interactive) chips for context. */
  baseFields: FieldOption[]
  /** Toggleable columns. Checked ones are added to the table, in the order shown here. */
  optionalFields: FieldOption[]
  /** Called with the ordered list of currently-visible optional keys whenever the config changes (including the initial load from storage). */
  onChange: (visibleOptionalKeysInOrder: string[]) => void
  className?: string
}

/**
 * Base + optional field picker. Optional fields are checkbox-toggled and
 * reorderable via native HTML5 drag-and-drop (no dnd library) — dragging
 * only ever reorders within the optional set, base fields are fixed.
 * Persists to localStorage under `storageKey`.
 */
export function FieldConfigBar({ storageKey, baseFields, optionalFields, onChange, className }: FieldConfigBarProps) {
  const allKeys = optionalFields.map((f) => f.key)
  const labelOf = (key: string) => optionalFields.find((f) => f.key === key)?.label ?? key

  const [fields, setFields] = useState<FieldToggle[]>(() => mergeFieldConfig(allKeys, null))
  const dragIndex = useRef<number | null>(null)
  // Stable string key for the effect dep array below — `allKeys` is a fresh
  // array every render, `.join` gives it referential-equality-friendly identity.
  const optionalKeysJoined = allKeys.join(',')

  // Load persisted config on mount (and whenever the underlying column set changes).
  useEffect(() => {
    let stored: FieldToggle[] | null = null
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) stored = JSON.parse(raw)
    } catch {
      // ignore malformed/blocked storage
    }
    setFields(mergeFieldConfig(allKeys, stored))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, optionalKeysJoined])

  useEffect(() => {
    onChange(visibleKeys(fields))
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(fields))
    } catch {
      // ignore (private mode / quota)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, storageKey])

  function handleDrop(toIndex: number) {
    if (dragIndex.current === null) return
    setFields((prev) => reorderFields(prev, dragIndex.current!, toIndex))
    dragIndex.current = null
  }

  return (
    <div className={cn('flex flex-wrap items-start gap-4 text-sm', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-400 mr-1">基础字段</span>
        {baseFields.map((f) => (
          <span key={f.key} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500">
            {f.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-400 mr-1">可选字段（拖拽排序）</span>
        {fields.map((f, i) => (
          <label
            key={f.key}
            draggable
            onDragStart={() => { dragIndex.current = i }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(i)}
            className={cn(
              'flex cursor-move items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs select-none',
              f.visible ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500'
            )}
          >
            <input
              type="checkbox"
              checked={f.visible}
              onChange={() => setFields((prev) => toggleFieldVisibility(prev, f.key))}
              className="cursor-pointer"
            />
            {labelOf(f.key)}
          </label>
        ))}
      </div>
    </div>
  )
}
