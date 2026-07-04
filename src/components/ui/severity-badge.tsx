import { cn } from '@/lib/utils'

export type Severity = 'info' | 'opportunity' | 'warning' | 'alert' | string

const COLORS: Record<string, string> = {
  info: 'bg-mut/10 text-mut border border-line',
  opportunity: 'bg-ok/10 text-ok border border-ok/25',
  warning: 'bg-warn/10 text-warn border border-warn/25',
  alert: 'bg-bad/10 text-bad border border-bad/25',
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
        'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-mono font-medium',
        cls,
        className
      )}
    >
      {severity}
    </span>
  )
}
