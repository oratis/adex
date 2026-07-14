'use client'

import { cn } from '@/lib/utils'
import { quickRangeDates, type QuickRange } from '@/lib/dashboard-bi'

const PRESETS: { value: Exclude<QuickRange, 'custom'>; label: string }[] = [
  { value: '7d', label: '近7天' },
  { value: '14d', label: '近14天' },
  { value: '30d', label: '近30天' },
]

export interface DateRangeValue {
  start: string
  end: string
  quickRange: QuickRange
}

interface DateRangePickerProps {
  value: DateRangeValue
  onChange: (next: DateRangeValue) => void
  className?: string
}

/**
 * Generic start/end date-range control with quick-range presets, native
 * `<input type="date">` for custom ranges. No date-picker dependency.
 */
export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  function selectPreset(preset: Exclude<QuickRange, 'custom'>) {
    const { start, end } = quickRangeDates(preset)
    onChange({ start, end, quickRange: preset })
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex items-center gap-1 rounded-lg border border-gray-300 p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => selectPreset(p.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              value.quickRange === p.value
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...value, quickRange: 'custom' })}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            value.quickRange === 'custom'
              ? 'bg-gray-900 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          )}
        >
          自定义
        </button>
      </div>
      <input
        type="date"
        value={value.start}
        max={value.end}
        onChange={(e) => onChange({ ...value, start: e.target.value, quickRange: 'custom' })}
        className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
        aria-label="start date"
      />
      <span className="text-gray-400 text-sm">–</span>
      <input
        type="date"
        value={value.end}
        min={value.start}
        onChange={(e) => onChange({ ...value, end: e.target.value, quickRange: 'custom' })}
        className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
        aria-label="end date"
      />
    </div>
  )
}
