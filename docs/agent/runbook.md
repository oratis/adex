# Agent Runbook

Operational guide for the Adex Agent system. Use this when something looks wrong on `/decisions`, `/approvals`, or in the cron logs.

## Cron map

| Cron | Path | Frequency | What breaks if it stops |
|---|---|---|---|
| Agent loop | `POST /api/cron/agent` | hourly | snapshots stale, no new decisions, drift not detected, no auto-downgrade |
| Approval expiry | `POST /api/cron/agent-expire` | hourly | 72h-old approvals never auto-reject |
| Webhook retry | `POST /api/cron/webhook-retry` | hourly | failed deliveries never retry |
| Daily digest | `POST /api/cron/daily` | daily | digest emails stop |
| Retention | `POST /api/cron/agent-retention` | daily | tables grow unbounded |
| Weekly digest | `POST /api/cron/agent-weekly` | weekly | weekly summary email stops |

All require `X-Cron-Secret: <CRON_SECRET>` header.

## Triage by symptom

### "No new decisions for hours"
1. `/decisions` page → check `enabled=true`, `killSwitch=false`.
2. `/agent-cost` → check monthly LLM budget hasn't been exhausted (`llm_budget_cap` guardrail blocks plan() once spent ≥ cap).
3. `GET /api/agent/stats?days=2` → if `decisionsTotal=0` but agent is enabled, last cron may have failed silently. Check Cloud Run logs for `[cron/agent]` entries.
4. Manually invoke: hit "Run now" on `/decisions` — surfaces immediate errors.

### "Drift banner appears on a campaign"
- Banner means `Campaign.desiredStatus != syncedStatus`. Either:
  - Someone changed the campaign in the platform UI directly → re-issue the desired state with the campaign PUT, or update desired to match platform.
  - The platform side rejected our last status update — check `Campaign.syncError`.
- For `managedByAgent=true` campaigns, drift auto-creates a `PendingApproval` of severity `warning`. Resolve it via `/approvals`.

### "Decision regression rate is climbing"
- `GET /api/agent/stats?days=14` → check `outcomes.regression / decisionsTotal`.
- Auto-downgrade fires when 3 consecutive verified outcomes are regressions (cron path: `safeguards.checkRegressionDowngrade`). It demotes mode and fires `agent.killswitch.activated` webhook.
- After a downgrade: read recent `Decision.steps[].toolInput` to spot the offending pattern, then add a guardrail (e.g. `requires_approval_above_spend`).

### "Webhook subscriber is not receiving events"
1. `/webhooks?status=pending` → see what's in the retry queue with non-zero attempts.
2. `/webhooks?status=abandoned` → confirm whether anything has hit `maxAttempts`. Hit "Requeue now" after the receiver is fixed.
3. Inbound: `Webhook.failureCount` rising means consecutive failures. Reset by editing the row.
4. Slack URL? `lib/slack-payload.ts` re-shapes payload automatically when `hooks.slack.com/services` is in the URL.

### "Agent picks the same bad decision repeatedly"
- The `cooldown` guardrail blocks identical steps within 4h by default. Check `DecisionStep.guardrailReport` JSON.
- If cooldown is bypassed because the input differs slightly, tighten with a per-tool `max_per_day` guardrail.

### "PromptRun.parsed is < 100%"
- `GET /api/agent/prompt-runs?days=7` → if a specific PromptVersion has parse errors, the LLM stopped returning valid JSON.
- Check the prompt template: did the placeholders get truncated? Did someone add a non-JSON example to the body?
- Roll back: `POST /api/agent/prompts/{previous-version-id}/promote`.

### "PromptRun cost spike"
- `/agent-cost` → if utilization crosses 60% mid-month, raise the cap (`PUT /api/agent/config { monthlyLlmBudgetUsd }`) or shrink the perceive context (drop campaigns with no recent spend).
- Disk-fallback prompt has no PromptRun row but Decision.llmCostUsd still tracks cost.

## Kill switch

`PUT /api/agent/config { killSwitch: true, killSwitchReason: "..." }` — owner/admin only.

When active:
- `runAgentLoop` returns immediately without calling LLM
- All cron paths skip the org
- Pending approvals remain (humans can still resolve them)
- Decisions UI shows red banner

To clear: `PUT /api/agent/config { killSwitch: false }`.

## Rollback

Per-decision: `POST /api/agent/decisions/{id}/rollback` builds a new "rollback decision" with each step's `inverse` and executes immediately. Steps marked `reversible=false` are skipped (you'll see them in the response's `skipped` array).

If a tool's `inverse()` returns null (e.g. budget change without `previousDailyBudget`), the only recourse is a fresh decision with the desired state.

## Safe mode (manual)

If you suspect runaway behavior:
1. Flip `killSwitch: true` immediately
2. `/approvals` → reject anything pending
3. `PUT /api/agent/config { mode: "shadow" }` (mode change is allowed even with kill switch active)
4. `PUT /api/agent/config { killSwitch: false }`
5. Watch `/decisions` for one cycle to confirm no destructive proposals
