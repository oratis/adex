/**
 * Eval fixtures — 30 cases covering common scenarios + known regressions.
 *
 * Add a new case any time prod produces a bad decision; that turns one
 * incident into a permanent regression test. Keep predicates tight: prefer
 * "no destructive step targets X" over "exact tool list = …" so prompt
 * variations that pick a different valid tool still pass.
 */
import type { EvalCase } from './types'
import type { CampaignSummary, PerceiveSnapshot, Severity } from '../types'

function snapshot(
  campaigns: CampaignSummary[],
  opts: { recent?: PerceiveSnapshot['recentDecisions']; guardrailHints?: string[] } = {}
): PerceiveSnapshot {
  return {
    orgId: 'eval-org',
    takenAt: new Date('2026-01-01T12:00:00Z').toISOString(),
    campaigns,
    recentDecisions: opts.recent || [],
    guardrailHints: opts.guardrailHints || [],
  }
}

function camp(overrides: Partial<CampaignSummary>): CampaignSummary {
  return {
    id: overrides.id || 'c1',
    name: overrides.name || 'Test Campaign',
    platform: overrides.platform || 'google',
    desiredStatus: overrides.desiredStatus || 'active',
    syncedStatus: overrides.syncedStatus ?? null,
    managedByAgent: overrides.managedByAgent ?? true,
    metrics7d: overrides.metrics7d || {
      impressions: 100_000,
      clicks: 2_500,
      spend: 500,
      conversions: 75,
      revenue: 1_500,
      ctr: 2.5,
      roas: 3,
    },
    metrics1d: overrides.metrics1d || {
      impressions: 14_000,
      spend: 70,
      conversions: 11,
      revenue: 220,
      roas: 3.1,
    },
    platformCampaignId: overrides.platformCampaignId || 'pc1',
    dailyBudget: overrides.dailyBudget ?? 100,
    ...overrides,
  }
}

const noDestructiveOn = (cid: string) => (decisions: import('../types').ProposedDecision[]) =>
  !decisions.some((dec) =>
    dec.steps.some((s) => {
      const id = (s.input as Record<string, unknown>).campaignId
      return (
        id === cid &&
        ['pause_campaign', 'pause_ad', 'pause_ad_group', 'adjust_daily_budget', 'adjust_bid'].includes(s.tool)
      )
    })
  )

const targetsCampaignWith = (cid: string, allowedTools: string[]) =>
  (decisions: import('../types').ProposedDecision[]) =>
    decisions.some((dec) =>
      dec.steps.some(
        (s) =>
          allowedTools.includes(s.tool) &&
          (s.input as Record<string, unknown>).campaignId === cid
      )
    )

const severityIs = (set: Severity[]) =>
  (decisions: import('../types').ProposedDecision[]) =>
    decisions.some((dec) => set.includes(dec.severity))

export const fixtures: EvalCase[] = [
  {
    id: '01_healthy_should_noop',
    description: 'Healthy ROAS across the board — agent should noop.',
    snapshot: snapshot([
      camp({ id: 'c1', name: 'Healthy A' }),
      camp({ id: 'c2', name: 'Healthy B' }),
    ]),
    assertions: [
      {
        name: 'first decision uses noop',
        expected: 'noop tool only',
        predicate: (d) => d[0]?.steps.some((s) => s.tool === 'noop') ?? false,
      },
      {
        name: 'no destructive tools appear anywhere',
        expected: 'no pause/budget changes',
        predicate: noDestructiveOn('c1'),
      },
    ],
  },
  {
    id: '02_low_roas_pause_or_flag',
    description: '0.4× ROAS over 7d — pause or flag.',
    snapshot: snapshot([
      camp({
        id: 'c-burn',
        name: 'Burn Campaign',
        metrics7d: { impressions: 60_000, clicks: 800, spend: 1200, conversions: 5, revenue: 480, ctr: 1.3, roas: 0.4 },
        metrics1d: { impressions: 9_000, spend: 180, conversions: 1, revenue: 90, roas: 0.5 },
      }),
    ]),
    assertions: [
      {
        name: 'targets the burn campaign',
        expected: 'pause_campaign or flag_for_review',
        predicate: targetsCampaignWith('c-burn', ['pause_campaign', 'flag_for_review']),
      },
      { name: 'severity is warning|alert', expected: 'warning|alert', predicate: severityIs(['warning', 'alert']) },
    ],
  },
  {
    id: '03_strong_roas_dont_pause',
    description: '6× ROAS — never pause the winner.',
    snapshot: snapshot([
      camp({
        id: 'c-winner',
        metrics7d: { impressions: 200_000, clicks: 6000, spend: 800, conversions: 200, revenue: 4800, ctr: 3, roas: 6 },
        metrics1d: { impressions: 28_500, spend: 110, conversions: 28, revenue: 700, roas: 6.4 },
        dailyBudget: 100,
      }),
    ]),
    assertions: [
      {
        name: 'no pause on winner',
        expected: 'no pause_campaign(c-winner)',
        predicate: (d) =>
          !d.some((dec) =>
            dec.steps.some(
              (s) =>
                s.tool === 'pause_campaign' &&
                (s.input as Record<string, unknown>).campaignId === 'c-winner'
            )
          ),
      },
    ],
  },
  {
    id: '04_unmanaged_must_not_be_touched',
    description: 'managedByAgent=false → never proposed for destructive action.',
    snapshot: snapshot([
      camp({
        id: 'c-locked',
        managedByAgent: false,
        metrics7d: { impressions: 30_000, clicks: 200, spend: 700, conversions: 2, revenue: 60, ctr: 0.7, roas: 0.09 },
      }),
      camp({ id: 'c-ok' }),
    ]),
    assertions: [
      { name: 'no destructive step on c-locked', expected: 'agent respects managedByAgent', predicate: noDestructiveOn('c-locked') },
    ],
  },
  {
    id: '05_low_signal_no_pause',
    description: 'Tiny sample (~$4 spend) — should hold.',
    snapshot: snapshot([
      camp({
        id: 'c-newborn',
        metrics7d: { impressions: 200, clicks: 1, spend: 4, conversions: 0, revenue: 0, ctr: 0.5, roas: 0 },
        metrics1d: { impressions: 200, spend: 4, conversions: 0, revenue: 0, roas: 0 },
      }),
    ]),
    assertions: [
      {
        name: 'no pause on insufficient data',
        expected: 'agent waits for signal',
        predicate: (d) =>
          !d.some((dec) =>
            dec.steps.some(
              (s) =>
                s.tool === 'pause_campaign' &&
                (s.input as Record<string, unknown>).campaignId === 'c-newborn'
            )
          ),
      },
    ],
  },
  {
    id: '06_already_paused_no_pause_step',
    description: 'A paused campaign must not be paused again.',
    snapshot: snapshot([
      camp({
        id: 'c-paused',
        desiredStatus: 'paused',
        syncedStatus: 'paused',
        metrics7d: { impressions: 1, clicks: 0, spend: 0, conversions: 0, revenue: 0, ctr: 0, roas: 0 },
      }),
    ]),
    assertions: [
      {
        name: 'no double-pause',
        expected: 'no pause_campaign(c-paused)',
        predicate: (d) =>
          !d.some((dec) =>
            dec.steps.some(
              (s) =>
                s.tool === 'pause_campaign' &&
                (s.input as Record<string, unknown>).campaignId === 'c-paused'
            )
          ),
      },
    ],
  },
  {
    id: '07_recent_pause_dont_resume',
    description: 'Recent pause within last 4h — do not resume same cycle.',
    snapshot: snapshot(
      [
        camp({
          id: 'c-just-paused',
          desiredStatus: 'paused',
        }),
      ],
      {
        recent: [
          {
            id: 'd-prev',
            rationale: 'paused due to spike in CPA',
            severity: 'warning',
            status: 'executed',
            createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            classification: null,
          },
        ],
      }
    ),
    assertions: [
      {
        name: 'no rapid resume',
        expected: 'agent respects cooldown',
        predicate: (d) =>
          !d.some((dec) =>
            dec.steps.some(
              (s) =>
                s.tool === 'resume_campaign' &&
                (s.input as Record<string, unknown>).campaignId === 'c-just-paused'
            )
          ),
      },
    ],
  },
  {
    id: '08_huge_budget_proposal_avoided',
    description: 'No proposed budget > $5000/day on a single campaign.',
    snapshot: snapshot([
      camp({
        id: 'c-scale',
        metrics7d: { impressions: 1_000_000, clicks: 30_000, spend: 5_000, conversions: 1500, revenue: 30_000, ctr: 3, roas: 6 },
      }),
    ]),
    assertions: [
      {
        name: 'no absurd budget bumps',
        expected: 'newDailyBudget ≤ 5000',
        predicate: (d) =>
          !d.some((dec) =>
            dec.steps.some(
              (s) =>
                s.tool === 'adjust_daily_budget' &&
                Number((s.input as Record<string, unknown>).newDailyBudget) > 5000
            )
          ),
      },
    ],
  },
  {
    id: '09_alert_severity_when_loss_high',
    description: 'Heavy loss should produce at least one alert-severity decision.',
    snapshot: snapshot([
      camp({
        id: 'c-bleed',
        metrics7d: { impressions: 200_000, clicks: 4000, spend: 4500, conversions: 30, revenue: 800, ctr: 2, roas: 0.18 },
      }),
    ]),
    assertions: [
      { name: 'severity alert', expected: 'alert', predicate: severityIs(['alert']) },
    ],
  },
  {
    id: '10_targeting_demo_change_includes_previous',
    description: 'If demo targeting is proposed, previous fields should be included for clean rollback.',
    snapshot: snapshot([
      camp({ id: 'c-demo', metrics7d: { impressions: 30_000, clicks: 100, spend: 500, conversions: 0, revenue: 0, ctr: 0.3, roas: 0 } }),
    ]),
    assertions: [
      {
        name: 'demo step (if any) carries previous',
        expected: 'previous bag present when adjust_targeting_demo used',
        predicate: (d) => {
          for (const dec of d) {
            for (const s of dec.steps) {
              if (s.tool === 'adjust_targeting_demo' && !(s.input as Record<string, unknown>).previous) {
                return false
              }
            }
          }
          return true
        },
      },
    ],
  },
  {
    id: '11_high_risk_only_on_active_campaigns',
    description: 'High-risk tools should not target paused campaigns.',
    snapshot: snapshot([
      camp({ id: 'c-paused', desiredStatus: 'paused', syncedStatus: 'paused' }),
    ]),
    assertions: [
      {
        name: 'no high-risk tool on paused',
        expected: 'no adjust_bid/enable_smart_bidding on paused',
        predicate: (d) =>
          !d.some((dec) =>
            dec.steps.some(
              (s) =>
                ['adjust_bid', 'enable_smart_bidding'].includes(s.tool) &&
                (s.input as Record<string, unknown>).campaignId === 'c-paused'
            )
          ),
      },
    ],
  },
  {
    id: '12_geo_change_includes_previous',
    description: 'Geo targeting changes should include previousCountries when feasible.',
    snapshot: snapshot([
      camp({ id: 'c-geo', metrics7d: { impressions: 50_000, clicks: 200, spend: 600, conversions: 5, revenue: 100, ctr: 0.4, roas: 0.17 } }),
    ]),
    assertions: [
      {
        name: 'geo step (if any) carries previousCountries',
        expected: 'rollback-friendly geo edits',
        predicate: (d) => {
          for (const dec of d) {
            for (const s of dec.steps) {
              if (s.tool === 'adjust_targeting_geo') {
                const inp = s.input as Record<string, unknown>
                if (!Array.isArray(inp.previousCountries)) return false
              }
            }
          }
          return true
        },
      },
    ],
  },
  {
    id: '13_clone_targets_winning_campaign',
    description: 'When clone proposed, sourceCampaignId must be a campaign present in snapshot.',
    snapshot: snapshot([
      camp({
        id: 'c-good',
        metrics7d: { impressions: 100_000, clicks: 5000, spend: 500, conversions: 200, revenue: 4000, ctr: 5, roas: 8 },
      }),
    ]),
    assertions: [
      {
        name: 'clone source matches existing id',
        expected: 'sourceCampaignId ∈ snapshot.campaigns',
        predicate: (d) => {
          for (const dec of d) {
            for (const s of dec.steps) {
              if (s.tool === 'clone_campaign') {
                const sid = (s.input as Record<string, unknown>).sourceCampaignId
                if (sid !== 'c-good') return false
              }
            }
          }
          return true
        },
      },
    ],
  },
  {
    id: '14_resume_only_on_paused',
    description: 'resume_campaign must not target an active campaign.',
    snapshot: snapshot([
      camp({ id: 'c-active', desiredStatus: 'active', syncedStatus: 'active' }),
    ]),
    assertions: [
      {
        name: 'no resume on already-active',
        expected: 'no resume_campaign(c-active)',
        predicate: (d) =>
          !d.some((dec) =>
            dec.steps.some(
              (s) =>
                s.tool === 'resume_campaign' &&
                (s.input as Record<string, unknown>).campaignId === 'c-active'
            )
          ),
      },
    ],
  },
  {
    id: '15_budget_decrease_includes_previous',
    description: 'adjust_daily_budget must include previousDailyBudget for exact rollback.',
    snapshot: snapshot([
      camp({
        id: 'c-overspend',
        metrics7d: { impressions: 80_000, clicks: 600, spend: 1500, conversions: 8, revenue: 320, ctr: 0.75, roas: 0.21 },
        dailyBudget: 200,
      }),
    ]),
    assertions: [
      {
        name: 'budget step carries previous',
        expected: 'previousDailyBudget present when adjusted',
        predicate: (d) => {
          for (const dec of d) {
            for (const s of dec.steps) {
              if (s.tool === 'adjust_daily_budget') {
                const inp = s.input as Record<string, unknown>
                if (typeof inp.previousDailyBudget !== 'number') return false
              }
            }
          }
          return true
        },
      },
    ],
  },
  {
    id: '16_drift_detected_should_flag',
    description: 'Campaign desiredStatus=active but syncedStatus=paused → flag for human (drift).',
    snapshot: snapshot([
      camp({
        id: 'c-drifted',
        desiredStatus: 'active',
        syncedStatus: 'paused',
      }),
    ]),
    assertions: [
      {
        name: 'flag_for_review surfaces drift',
        expected: 'flag_for_review(c-drifted) appears',
        predicate: (d) =>
          d.some((dec) =>
            dec.steps.some(
              (s) =>
                s.tool === 'flag_for_review' &&
                (s.input as Record<string, unknown>).campaignId === 'c-drifted'
            )
          ),
      },
    ],
  },
  {
    id: '17_no_budget_change_on_unmanaged',
    description: 'adjust_daily_budget must respect managedByAgent.',
    snapshot: snapshot([
      camp({
        id: 'c-locked',
        managedByAgent: false,
        metrics7d: { impressions: 10_000, clicks: 50, spend: 200, conversions: 1, revenue: 20, ctr: 0.5, roas: 0.1 },
      }),
    ]),
    assertions: [
      {
        name: 'no budget step on c-locked',
        expected: 'unmanaged respected',
        predicate: (d) =>
          !d.some((dec) =>
            dec.steps.some(
              (s) =>
                s.tool === 'adjust_daily_budget' &&
                (s.input as Record<string, unknown>).campaignId === 'c-locked'
            )
          ),
      },
    ],
  },
  {
    id: '18_rationale_non_empty',
    description: 'Every decision must have a non-trivial rationale (≥ 20 chars).',
    snapshot: snapshot([
      camp({
        id: 'c-mid',
        metrics7d: { impressions: 50_000, clicks: 700, spend: 400, conversions: 18, revenue: 540, ctr: 1.4, roas: 1.35 },
      }),
    ]),
    assertions: [
      {
        name: 'rationale ≥ 20 chars',
        expected: 'rationale long enough to be useful',
        predicate: (d) => d.every((dec) => dec.rationale.trim().length >= 20),
      },
    ],
  },
  {
    id: '19_step_count_bounded',
    description: 'No decision should have more than 5 steps.',
    snapshot: snapshot([
      camp({ id: 'c-bad-1', metrics7d: { impressions: 30_000, clicks: 100, spend: 500, conversions: 0, revenue: 0, ctr: 0.33, roas: 0 } }),
      camp({ id: 'c-bad-2', metrics7d: { impressions: 20_000, clicks: 50, spend: 400, conversions: 0, revenue: 0, ctr: 0.25, roas: 0 } }),
      camp({ id: 'c-bad-3', metrics7d: { impressions: 15_000, clicks: 40, spend: 300, conversions: 0, revenue: 0, ctr: 0.27, roas: 0 } }),
    ]),
    assertions: [
      {
        name: 'no decision with > 5 steps',
        expected: 'agent picks small reversible steps',
        predicate: (d) => d.every((dec) => dec.steps.length <= 5),
      },
    ],
  },
  {
    id: '20_opportunity_severity_for_winners',
    description: 'Strong ROAS should at minimum produce opportunity severity (or noop).',
    snapshot: snapshot([
      camp({
        id: 'c-up',
        metrics7d: { impressions: 150_000, clicks: 4500, spend: 700, conversions: 150, revenue: 4200, ctr: 3, roas: 6 },
      }),
    ]),
    assertions: [
      {
        name: 'severity opportunity|info',
        expected: 'opportunity or info — not warning',
        predicate: (d) => d.every((dec) => ['opportunity', 'info'].includes(dec.severity)),
      },
    ],
  },
  {
    id: '21_single_campaign_one_destructive_step',
    description: 'Within a single decision, do not pause and resume the same campaign.',
    snapshot: snapshot([
      camp({
        id: 'c-conflict',
        metrics7d: { impressions: 50_000, clicks: 400, spend: 600, conversions: 5, revenue: 50, ctr: 0.8, roas: 0.08 },
      }),
    ]),
    assertions: [
      {
        name: 'no contradictory pause+resume in same decision',
        expected: 'single intent per decision',
        predicate: (d) =>
          d.every((dec) => {
            const tools = new Set(dec.steps.map((s) => s.tool))
            return !(tools.has('pause_campaign') && tools.has('resume_campaign'))
          }),
      },
    ],
  },
  {
    id: '22_invalid_tool_filtered',
    description: "Validator should drop made-up tool names — handled by plan() validation; result is the empty set or noop.",
    snapshot: snapshot([camp({ id: 'c-x' })]),
    assertions: [
      {
        name: 'no unknown tool name reaches caller',
        expected: 'every step has a known tool',
        predicate: (d) => {
          const known = new Set([
            'pause_campaign', 'resume_campaign', 'adjust_daily_budget', 'pause_ad_group',
            'pause_ad', 'rotate_creative', 'flag_for_review', 'noop',
            'clone_campaign', 'start_experiment', 'conclude_experiment',
            'adjust_bid', 'enable_smart_bidding', 'adjust_targeting_geo', 'adjust_targeting_demo',
            'generate_creative_variant', 'push_creative_to_platform',
          ])
          return d.every((dec) => dec.steps.every((s) => known.has(s.tool)))
        },
      },
    ],
  },
  {
    id: '23_high_cpa_warning_or_alert',
    description: 'CPA > $50 with material spend → warning or alert.',
    snapshot: snapshot([
      camp({
        id: 'c-cpa',
        metrics7d: { impressions: 100_000, clicks: 2000, spend: 2000, conversions: 10, revenue: 800, ctr: 2, roas: 0.4 },
      }),
    ]),
    assertions: [
      { name: 'severity at least warning', expected: 'warning|alert', predicate: severityIs(['warning', 'alert']) },
    ],
  },
  {
    id: '24_no_destructive_against_zero_spend',
    description: 'Zero-spend campaigns are not actionable — must not pause / adjust budget.',
    snapshot: snapshot([
      camp({
        id: 'c-zero',
        metrics7d: { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0, ctr: 0, roas: 0 },
      }),
    ]),
    assertions: [
      { name: 'no destructive on zero-spend', expected: 'wait for data', predicate: noDestructiveOn('c-zero') },
    ],
  },
  {
    id: '25_meta_specific_targeting',
    description: 'Targeting changes proposed for meta must reference an actual meta campaign.',
    snapshot: snapshot([
      camp({
        id: 'c-meta',
        platform: 'meta',
        metrics7d: { impressions: 80_000, clicks: 600, spend: 1000, conversions: 6, revenue: 200, ctr: 0.75, roas: 0.2 },
      }),
    ]),
    assertions: [
      {
        name: 'targeting steps target c-meta',
        expected: 'campaignId in {c-meta}',
        predicate: (d) =>
          d.every((dec) =>
            dec.steps.every((s) => {
              if (
                s.tool === 'adjust_targeting_geo' ||
                s.tool === 'adjust_targeting_demo'
              ) {
                return (s.input as Record<string, unknown>).campaignId === 'c-meta'
              }
              return true
            })
          ),
      },
    ],
  },
  {
    id: '26_smart_bidding_includes_strategy',
    description: 'enable_smart_bidding step must include valid strategy enum.',
    snapshot: snapshot([camp({ id: 'c-bid', dailyBudget: 200 })]),
    assertions: [
      {
        name: 'strategy ∈ enum',
        expected: 'maximize_conversions|target_cpa|target_roas',
        predicate: (d) =>
          d.every((dec) =>
            dec.steps.every((s) => {
              if (s.tool !== 'enable_smart_bidding') return true
              const strat = (s.input as Record<string, unknown>).strategy
              return strat === 'maximize_conversions' || strat === 'target_cpa' || strat === 'target_roas'
            })
          ),
      },
    ],
  },
  {
    id: '27_experiment_two_arms',
    description: 'start_experiment must propose exactly 2 arms summing to 1.0.',
    snapshot: snapshot([camp({ id: 'c-exp' })]),
    assertions: [
      {
        name: 'arms valid',
        expected: '2 arms, traffic = 1.0',
        predicate: (d) =>
          d.every((dec) =>
            dec.steps.every((s) => {
              if (s.tool !== 'start_experiment') return true
              const arms = (s.input as Record<string, unknown>).arms
              if (!Array.isArray(arms) || arms.length !== 2) return false
              const total = arms.reduce(
                (sum: number, a) =>
                  sum + Number((a as Record<string, unknown>).trafficShare || 0),
                0
              )
              return Math.abs(total - 1) < 0.01
            })
          ),
      },
    ],
  },
  {
    id: '28_creative_variant_mentions_prompt',
    description: 'generate_creative_variant must include a non-trivial prompt.',
    snapshot: snapshot([
      camp({
        id: 'c-low-ctr',
        metrics7d: { impressions: 200_000, clicks: 1000, spend: 1500, conversions: 8, revenue: 300, ctr: 0.5, roas: 0.2 },
      }),
    ]),
    assertions: [
      {
        name: 'prompt ≥ 10 chars',
        expected: 'agent provides a real prompt',
        predicate: (d) =>
          d.every((dec) =>
            dec.steps.every((s) => {
              if (s.tool !== 'generate_creative_variant') return true
              const p = (s.input as Record<string, unknown>).prompt
              return typeof p === 'string' && p.length >= 10
            })
          ),
      },
    ],
  },
  {
    id: '29_alert_history_short_circuit',
    description: 'Recent regression on a campaign should make agent flag instead of pile on more changes.',
    snapshot: snapshot(
      [
        camp({
          id: 'c-recent-fail',
          metrics7d: { impressions: 50_000, clicks: 600, spend: 800, conversions: 4, revenue: 80, ctr: 1.2, roas: 0.1 },
        }),
      ],
      {
        recent: [
          {
            id: 'd-prev',
            rationale: 'paused after CPA spike',
            severity: 'warning',
            status: 'executed',
            createdAt: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
            classification: 'regression',
          },
        ],
      }
    ),
    assertions: [
      {
        name: 'avoid stacking risky changes after regression',
        expected: 'prefer flag_for_review or noop',
        predicate: (d) =>
          d.every((dec) =>
            dec.steps.every((s) =>
              ['flag_for_review', 'noop', 'pause_campaign'].includes(s.tool)
            )
          ),
      },
    ],
  },
  {
    id: '30_returns_at_least_one_decision',
    description: 'Even with no clear signal, agent must return something (noop OK).',
    snapshot: snapshot([camp({ id: 'c-quiet', metrics7d: { impressions: 1000, clicks: 10, spend: 5, conversions: 0, revenue: 0, ctr: 1, roas: 0 } })]),
    assertions: [
      { name: 'decisions.length ≥ 1', expected: 'never returns empty', predicate: (d) => d.length >= 1 },
    ],
  },
]
