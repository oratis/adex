import { cn } from '@/lib/utils'

export type Severity = 'info' | 'opportunity' | 'warning' | 'alert' | string

const COLORS: Record<string, string> = {
  info: 'bg-gray-100 text-gray-700',
  opportunity: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  alert: 'bg-rose-100 text-rose-700',
}

/**
 * Audit Med #21: shared color map for Decision/Approval severity. Replaces
 * the SEVERITY_COLORS literal that was duplicated across 5 files.
 */
export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity
  className?: string
}) {
  const cls = COLORS[severity] || COLORS.info
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        cls,
        className
      )}
    >
      {severity}
    </span>
  )
}
