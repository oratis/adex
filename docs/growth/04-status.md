# Growth OS — build status & handoff

> Version v1 · 2026-07-04 · Snapshot of what's built vs what remains.

## Shipped (verified: prisma validate/generate · 251 vitest · tsc · eslint · next build)

Three stacked PRs — **merge in order 1 → 2 → 3**:

| PR | Scope | Branch |
| --- | --- | --- |
| [#1](https://github.com/oratis/adex/pull/1) | Growth OS P18–P19 + loopback design language | `feat/growth-cuddler-pilot` → `main` |
| [#2](https://github.com/oratis/adex/pull/2) | Creative Studio (物料 capability) | `feat/growth-creative-studio` → #1 |
| [#3](https://github.com/oratis/adex/pull/3) | P21 Growth Agent | `feat/growth-agent-p21` → #2 |

**P18** measurement底座 · **P19** organic attribution + paid readiness · **P20** Creative Studio · **P21** agent integration. Full detail: [00-cuddler-first-redesign.md](00-cuddler-first-redesign.md), [01-5k-pilot-plan.md](01-5k-pilot-plan.md), [03-creative-studio.md](03-creative-studio.md).

Every decision/attribution/spec/validation module is pure + unit-tested under `src/lib/growth/*` and `src/lib/agent/tools/*`.

## Remaining — external-service seams (decision layer built + tested; needs creds)

Each item's pure logic is done and covered by tests; what's left is wiring the credentialed call.

| Seam | Decision layer ready | Needs |
| --- | --- | --- |
| **Adapter app-install writes** — real `OUTCOME_APP_PROMOTION` / `APP_PROMOTION` createCampaign | `campaign-objective.ts` (resolve + validate) + launch-route gate | Meta/TikTok/Google sandbox creds; adapter `launchCampaign` app-promotion branch |
| **Creative render** — variant → actual Seedance2/Seedream job → transcode/crop → platform push | `storyboard.ts`, `creative-specs.ts` (validate/needs_transcode), `studio/produce` (creates the Creative + prompt) | `SEEDANCE2_API_KEY` / Seedream; a transcode worker |
| **GA4 event-level pull** | `ga4.ts` mapper + `ingest/events` push (the real-time path) | GA4 **BigQuery export** for user-level events (Data API is aggregate-only) — or rely on the push channel |
| **RevenueCat / ASC live pull** | `revenuecat.ts` mapper + `/api/ingest/revenuecat` webhook (real-time path works) | ASC `.p8` key for the batch pull (webhook already covers real-time) |
| **Cuddler-side contract items** | — | See [02-integration-contract.md](02-integration-contract.md) §3 (RC webhook secret, GA4 授权, video daily cap, spending limits) |

## CI note

`prompt-eval` requires `ANTHROPIC_API_KEY` in Actions secrets; without it the eval now **skips** (not fails) so agent PRs aren't blocked — but to actually run the 90% pass-rate gate, configure that secret.

## Suggested next milestone

Once a platform sandbox + `SEEDANCE2_API_KEY` are available: wire the adapter app-install branch + the produce→render→push loop end-to-end against a test ad account — the first real $5K-pilot campaign created entirely inside Adex.

## 2026-07-07 · fork contributions (PR #4–#7, stacked, merge in order)

| PR | Scope | Key change |
| --- | --- | --- |
| [#4](https://github.com/oratis/adex/pull/4) | agent runtime | The four pilot disciplines wired as real guardrail evaluators; `executeApprovedDecision` re-checks guardrails at execution time (bypass closed); growth snapshot now rendered into the plan prompt |
| [#5](https://github.com/oratis/adex/pull/5) | data ingest | Adjust S2S callback → ConversionEvent with single install-source authority (anti-double-count), `ADJUST_NETWORK_MAP` channel mapping, namespaced userKey |
| [#6](https://github.com/oratis/adex/pull/6) | canon + BI | Signup-anchored cohorts (authority never filters signup), os/agency dims, D0/D7 revenue windows, spend injection (CAC no longer null), mature-window retention gating, `/api/growth/summary` + `/api/reports/breakdown`, dashboard BI view |
| [#7](https://github.com/oratis/adex/pull/7) | attribution | Campaign-name canon (`agency-date-bid-os-regions-channel-...`) parsed into agency/bidStrategy/conversionGoal; funnel↔delivery join on `(date, os, platform, agency)` |

Pipeline canon lives in [06-mmp-ingest.md](06-mmp-ingest.md) §6–§7. Ops prerequisites for live data: Adjust callback + `app_user_id` **callback parameter** (not partner parameter), backend pushes signup/payment with `source=backend`, campaign naming discipline from day one.
