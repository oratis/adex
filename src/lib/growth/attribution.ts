/**
 * KOL / creator natural-uplift attribution (pure) — ported method from
 * hakko-kol-agent. A creator post has no click-through tracking, so we measure
 * its impact as installs ABOVE the pre-publish baseline:
 *
 *   baseline (expected) = mean(daily installs over the `baselineDays` before
 *                              publish) × windowDays
 *   uplift              = max(0, installs in the post-publish window − baseline)
 *   effective CPI       = cost / uplift   (null if no uplift)
 *
 * It's a quasi-experiment, not a controlled one — documented as directional.
 * Ref: docs/growth/00-cuddler-first-redesign.md §1.3 (hakko-kol-agent)
 */

import { dayKey } from './cohorts'
import { effectiveCpi } from './kpi-canon'

export interface UpliftResult {
  baselineDailyInstalls: number
  baselineInstalls: number // expected over the window
  windowInstalls: number // observed over the window
  upliftInstalls: number
  effectiveCpi: number | null
}

function addDaysKey(fromKey: string, days: number): string {
  const t = Date.parse(fromKey + 'T00:00:00.000Z') + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * Attribute a creator post from a daily install series.
 *
 * @param installsByDay map of `YYYY-MM-DD` (UTC) → install count for the
 *   relevant channel/segment (e.g. organic, where KOL traffic lands).
 * @param baselineDays days before publish used for the baseline (default 7).
 * @param windowDays post-publish attribution window (default 3).
 */
export function attributePost(params: {
  publishedAt: Date
  installsByDay: Map<string, number>
  costUsd: number
  baselineDays?: number
  windowDays?: number
}): UpliftResult {
  const baselineDays = params.baselineDays ?? 7
  const windowDays = params.windowDays ?? 3
  const pubKey = dayKey(params.publishedAt)
  const at = (k: string) => params.installsByDay.get(k) ?? 0

  // Baseline: the `baselineDays` days strictly before publish.
  let baseSum = 0
  for (let i = 1; i <= baselineDays; i++) baseSum += at(addDaysKey(pubKey, -i))
  const baselineDailyInstalls = baselineDays > 0 ? baseSum / baselineDays : 0

  // Window: publish day + (windowDays - 1) following days.
  let windowInstalls = 0
  for (let i = 0; i < windowDays; i++) windowInstalls += at(addDaysKey(pubKey, i))

  const baselineInstalls = baselineDailyInstalls * windowDays
  const upliftInstalls = Math.max(0, windowInstalls - baselineInstalls)

  return {
    baselineDailyInstalls,
    baselineInstalls,
    windowInstalls,
    upliftInstalls,
    effectiveCpi: effectiveCpi(params.costUsd, upliftInstalls),
  }
}
