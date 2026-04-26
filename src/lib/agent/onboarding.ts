/**
 * Onboarding gate per docs/agent/09-roadmap.md §Phase 16 work item 8:
 *   shadow → approval_only → autonomous
 * with a minimum dwell time per stage so customers don't skip straight to
 * autonomous on day one.
 *
 * Returns null if the proposed transition is allowed, or an Error message
 * explaining why it isn't.
 */
import type { AgentConfig } from '@/generated/prisma/client'

export type AgentMode = 'shadow' | 'approval_only' | 'autonomous'

const SHADOW_DWELL_HOURS = 7 * 24 // 1 week
const APPROVAL_DWELL_HOURS = 14 * 24 // 2 weeks

export function canTransitionMode(
  cfg: AgentConfig | null,
  to: AgentMode,
  options: { allowDowngrade?: boolean } = {}
): { allowed: true } | { allowed: false; reason: string } {
  const from = (cfg?.mode || 'shadow') as AgentMode
  const allowDowngrade = options.allowDowngrade ?? true
  if (from === to) return { allowed: true }

  const order: AgentMode[] = ['shadow', 'approval_only', 'autonomous']
  const fromIdx = order.indexOf(from)
  const toIdx = order.indexOf(to)
  if (toIdx < fromIdx) {
    return allowDowngrade
      ? { allowed: true }
      : { allowed: false, reason: 'Downgrade not permitted in this context' }
  }

  // Upgrades — enforce dwell time + (for autonomous) allowlist.
  if (to === 'approval_only') {
    if (from !== 'shadow')
      return { allowed: false, reason: 'approval_only must come from shadow' }
    const since = cfg?.shadowStartedAt
    if (!since)
      return {
        allowed: false,
        reason: `Set mode=shadow and let it run ≥ ${SHADOW_DWELL_HOURS / 24}d before upgrading`,
      }
    const hours = (Date.now() - since.getTime()) / 3_600_000
    if (hours < SHADOW_DWELL_HOURS) {
      return {
        allowed: false,
        reason: `shadow only ran ${hours.toFixed(1)}h; need ≥ ${SHADOW_DWELL_HOURS}h`,
      }
    }
    return { allowed: true }
  }

  if (to === 'autonomous') {
    if (from !== 'approval_only')
      return { allowed: false, reason: 'autonomous must come from approval_only' }
    if (!cfg?.autonomousAllowed)
      return {
        allowed: false,
        reason:
          'autonomousAllowed=false — this org is not on the autonomous allowlist. Contact ops to enable.',
      }
    const since = cfg?.approvalOnlyStartedAt
    if (!since)
      return {
        allowed: false,
        reason: `Set mode=approval_only and let it run ≥ ${APPROVAL_DWELL_HOURS / 24}d before upgrading`,
      }
    const hours = (Date.now() - since.getTime()) / 3_600_000
    if (hours < APPROVAL_DWELL_HOURS) {
      return {
        allowed: false,
        reason: `approval_only only ran ${hours.toFixed(1)}h; need ≥ ${APPROVAL_DWELL_HOURS}h`,
      }
    }
    return { allowed: true }
  }
  return { allowed: false, reason: `Unknown target mode ${to}` }
}

/**
 * Patch fields to set when transitioning. Returns the prisma data object the
 * caller should pass to upsert/update.
 */
export function transitionFields(
  to: AgentMode
): Record<string, unknown> {
  const now = new Date()
  if (to === 'shadow') return { mode: 'shadow', shadowStartedAt: now }
  if (to === 'approval_only') return { mode: 'approval_only', approvalOnlyStartedAt: now }
  if (to === 'autonomous') return { mode: 'autonomous', autonomousStartedAt: now }
  return {}
}
