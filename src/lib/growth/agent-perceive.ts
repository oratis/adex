/**
 * Growth block for the Agent's perceive() snapshot (P21). Folds CohortSnapshot
 * into a funnel + per-channel gate + pilot-budget summary so the agent plans
 * against the same numbers /growth shows — via kpi-canon, pilot-gates and
 * budget-guard (single source of truth).
 *
 * `summarizeGrowth` is pure/testable; `buildGrowthSnapshot` reads the DB and
 * returns null when the org has no cohort data (a no-op for non-growth orgs).
 *
 * Ref: docs/growth/00-cuddler-first-redesign.md §7.1
 */

import { prisma } from '@/lib/prisma'
import { activationRate, retentionRate, realizedLtv, eCACStar } from './kpi-canon'
import { evaluateChannel } from './pilot-gates'
import { evaluatePilotBudget } from './budget-guard'
import { isSkanChannel, type Channel } from './channels'

export interface CohortLike {
  channel: string
  installs: number
  activated: number
  d1Retained: number
  d7Retained: number
  subscribers: number
  revenueToDate: number
  cac: number | null
}

export interface GrowthChannelLine {
  channel: string
  installs: number
  d7Rate: number
  subscribers: number
  cac: number | null
  ecac: number | null
  gate: string
}

export interface GrowthSnapshot {
  funnel: { installs: number; activationRate: number; d1Rate: number; d7Rate: number; subscribers: number; revenue: number; ltv: number }
  channels: GrowthChannelLine[]
  budget: { cumulativeSpend: number; capTotal: number; pct: number; action: string }
  hints: string[]
}

/** Pure aggregation of cohort rows into the growth snapshot. */
export function summarizeGrowth(rows: CohortLike[]): GrowthSnapshot | null {
  if (rows.length === 0) return null

  const tot = { installs: 0, activated: 0, d1: 0, d7: 0, subscribers: 0, revenue: 0 }
  const byCh = new Map<string, CohortLike & { spend: number; hasSpend: boolean }>()
  for (const r of rows) {
    tot.installs += r.installs; tot.activated += r.activated; tot.d1 += r.d1Retained
    tot.d7 += r.d7Retained; tot.subscribers += r.subscribers; tot.revenue += r.revenueToDate
    let c = byCh.get(r.channel)
    if (!c) { c = { ...r, installs: 0, activated: 0, d1Retained: 0, d7Retained: 0, subscribers: 0, revenueToDate: 0, spend: 0, hasSpend: false }; byCh.set(r.channel, c) }
    c.installs += r.installs; c.activated += r.activated; c.d1Retained += r.d1Retained
    c.d7Retained += r.d7Retained; c.subscribers += r.subscribers; c.revenueToDate += r.revenueToDate
    if (r.cac !== null) { c.spend += r.cac * r.installs; c.hasSpend = true }
  }

  let cumulativeSpend = 0
  const channels: GrowthChannelLine[] = [...byCh.entries()].map(([channel, c]) => {
    if (c.hasSpend) cumulativeSpend += c.spend
    const d7 = retentionRate(c.d7Retained, c.installs)
    const gate = evaluateChannel({
      skanImmature: isSkanChannel(channel as Channel),
      spend: c.hasSpend ? c.spend : 0,
      installs: c.installs,
      activationRate: activationRate(c.activated, c.installs),
      d7,
      mediaSubsidyCost: 0,
      payingUsers: c.subscribers,
    })
    return {
      channel,
      installs: c.installs,
      d7Rate: d7,
      subscribers: c.subscribers,
      cac: c.hasSpend && c.installs > 0 ? c.spend / c.installs : null,
      ecac: c.hasSpend ? eCACStar({ spend: c.spend, mediaSubsidyCost: 0, installs: c.installs }) : null,
      gate: gate.decision,
    }
  }).sort((a, b) => b.installs - a.installs)

  const budget = evaluatePilotBudget({ cumulativeSpend })

  const hints: string[] = []
  if (budget.action !== 'ok') hints.push(`pilot budget ${(budget.pct * 100).toFixed(0)}% of cap → ${budget.action}`)
  for (const ch of channels) {
    if (ch.gate === 'kill') hints.push(`${ch.channel}: gate=kill`)
    else if (ch.gate === 'scale') hints.push(`${ch.channel}: gate=scale (payment signal present)`)
    else if (ch.gate === 'halve') hints.push(`${ch.channel}: gate=halve`)
  }

  return {
    funnel: {
      installs: tot.installs,
      activationRate: activationRate(tot.activated, tot.installs),
      d1Rate: retentionRate(tot.d1, tot.installs),
      d7Rate: retentionRate(tot.d7, tot.installs),
      subscribers: tot.subscribers,
      revenue: tot.revenue,
      ltv: realizedLtv(tot.revenue, tot.installs),
    },
    channels,
    budget: { cumulativeSpend, capTotal: 5000, pct: budget.pct, action: budget.action },
    hints,
  }
}

/** Read cohorts for an org and build the growth snapshot (null if none). */
export async function buildGrowthSnapshot(orgId: string): Promise<GrowthSnapshot | null> {
  const snaps = await prisma.cohortSnapshot.findMany({
    where: { orgId },
    select: { channel: true, installs: true, activated: true, d1Retained: true, d7Retained: true, subscribers: true, revenueToDate: true, cac: true },
  })
  return summarizeGrowth(snaps)
}
