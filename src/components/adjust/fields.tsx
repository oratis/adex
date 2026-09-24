import type { ReactNode } from 'react'
import type { MetricSlot, Traffic } from '@/lib/reports/adjust-data'
export const trafficNames: Record<Traffic, string> = {
  organic: '自然',
  paid: '付费',
  other: '其他已知',
  unknown: '未知',
}
export const metricNames: Record<MetricSlot, string> = {
  registration: '注册',
  payer: '付费人数',
  revenue: '收入',
}
export const inputClass =
  'w-full min-w-0 rounded border border-gray-300 bg-white px-3 py-2 text-sm'

export function Field({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string
  label: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <label htmlFor={htmlFor} className="block font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}
