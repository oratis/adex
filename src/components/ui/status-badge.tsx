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

// loopback tokens. `executing` = agent cyan (the agent is acting) — the
// human/agent agency encoding runs through the whole status vocabulary.
const COLORS: Record<string, string> = {
  pending: 'bg-warn/10 text-warn border border-warn/25',
  executed: 'bg-ok/10 text-ok border border-ok/25',
  failed: 'bg-bad/10 text-bad border border-bad/25',
  skipped: 'bg-mut/10 text-mut border border-line',
  rejected: 'bg-mut/10 text-mut border border-line',
  rolled_back: 'bg-max/10 text-max border border-max/25',
  executing: 'bg-ai/10 text-ai border border-ai/25',
  // Verify-related
  improved: 'bg-ok/10 text-ok border border-ok/25',
  neutral: 'bg-mut/10 text-mut border border-line',
  worse: 'bg-bad/10 text-bad border border-bad/25',
  inconclusive: 'bg-warn/10 text-warn border border-warn/25',
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
        'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-mono font-medium',
        cls,
        className
      )}
    >
      {label ?? status}
    </span>
  )
}
