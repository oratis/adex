# Agent Onboarding

How a new org goes from "agent disabled" to "running autonomously". Driven by [/agent-onboarding](../../src/app/(dashboard)/agent-onboarding/page.tsx) UI; this doc explains the constraints the runtime enforces.

## The three stages

```
shadow ──── ≥7 days ────► approval_only ──── ≥14 days + allowlist ────► autonomous
```

**Downgrades are instant.** Upgrades are gated server-side in [src/lib/agent/onboarding.ts](../../src/lib/agent/onboarding.ts).

### Stage 1: shadow (≥ 7 days)
- Plan/act/verify run on schedule, but **every tool no-ops** (records `DecisionStep.status='skipped'`).
- LLM cost still accrues — count it against `monthlyLlmBudgetUsd`.
- Watch `/decisions` for at least one cron tick. Sanity-check that:
  - the agent surfaces real issues (the eval harness covers the common ones)
  - rationales are sensible and reference real campaigns
  - severity distribution looks right (more `info`/`opportunity` than `alert`)

### Stage 2: approval_only (≥ 14 days)
- Every proposed step lands in `/approvals`. Nothing executes without a human click.
- Goal: build a track record. The longer this runs, the more `DecisionOutcome` rows accrue, and the safer the autonomous transition is.
- Use bulk approve/reject to keep the queue small. Aim for < 4h median response time.

### Stage 3: autonomous (allowlist + dwell)
- Two gates:
  1. **Allowlist**: `AgentConfig.autonomousAllowed=true`. Set via `POST /api/agent/config/autonomous-allowlist { allowed: true }`. **Owner-only** (admin can't grant their own org autonomous mode).
  2. **Dwell time**: ≥ 14 days in `approval_only`.
- Once enabled, decisions whose guardrails all pass execute without human approval. Anything with a blocked guardrail still routes through `/approvals`.
- Auto-downgrade fires after 3 consecutive verified regressions — see [safeguards.ts](../../src/lib/agent/safeguards.ts).

## Recommended pre-flight checklist

Before flipping `enabled=true`:

- [ ] PlatformLink rows exist for every active campaign. Run `tsx prisma/backfills/01_platform_links.ts --apply` if upgrading from a pre-P10 install.
- [ ] At least one Guardrail row OR confirm the 12 built-in evaluators are sufficient.
- [ ] `monthlyLlmBudgetUsd` set realistically (default $50, raise if you have > 50 active campaigns).
- [ ] At least one owner/admin has `dailyReportEmail` set so approval emails land somewhere.
- [ ] If using Slack, register the incoming webhook (see [slack.md](./slack.md)).
- [ ] Cron jobs configured (see runbook.md "Cron map").

## Recommended pre-autonomous checklist

Before clicking "Promote to autonomous":

- [ ] At least 14 days of approval_only with **non-trivial decision volume** (≥ 30 decisions). If volume is too low, dwell longer.
- [ ] Outcome distribution healthy: `success + neutral ≥ 80%` of verified outcomes (see `/agent-cost` or `/api/agent/stats?days=30`).
- [ ] Bulk approve/reject habits are working — admins know how to triage.
- [ ] Active set of guardrails appropriate for the org's risk tolerance:
  - `budget_max_daily` set to a number your CFO can sleep with
  - `budget_max_total_daily` set to org-wide ceiling
  - `requires_approval_above_spend` to keep large $-impact changes in human hands
- [ ] Kill switch UX known: every owner/admin should be able to find `/decisions → Kill switch` in < 30 seconds.

## Decommissioning

To pause indefinitely without losing data:

1. `PUT /api/agent/config { enabled: false }` — agent stops running.
2. Decisions, outcomes, prompts, guardrails persist.
3. Cron jobs still execute but skip the org (cheap no-op).

To delete entirely: drop the `AgentConfig` row. PlatformLink + Decisions/Outcomes will remain (audit trail).
