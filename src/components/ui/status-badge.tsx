import { cn } from '@/lib/utils'

export type DecisionStatus =
  | 'pending'
  | 'executed'
  | 'failed'
  | 'skipped'
  | 'rejected'
  | 'rolled_back'
  | 'executing'
  | string

const COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  executed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  skipped: 'bg-gray-100 text-gray-600',
  rejected: 'bg-gray-200 text-gray-700',
  rolled_back: 'bg-purple-100 text-purple-700',
  executing: 'bg-blue-100 text-blue-700',
  // Verify-related
  improved: 'bg-emerald-100 text-emerald-700',
  neutral: 'bg-gray-100 text-gray-700',
  worse: 'bg-rose-100 text-rose-700',
  inconclusive: 'bg-amber-100 text-amber-700',
}

/**
 * Audit Med #21: shared color map for Decision step status. Replaces
 * STATUS_COLORS literal duplicated across 5 files.
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: DecisionStatus
  /** Override displayed label (defaults to status). */
  label?: React.ReactNode
  className?: string
}) {
  const cls = COLORS[status] || COLORS.pending
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        cls,
        className
      )}
    >
      {label ?? status}
    </span>
  )
}
