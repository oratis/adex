# Media APIs + Adjust Reporting Contract

Date: 2026-09-24. Target source contract with a local Adjust setup implementation;
not a completed live integration or release.

## Source Boundary

Adex reporting should work with media APIs and Adjust, without depending on
data_agent/acquisition configuration, its databases, GA4, or RevenueCat.
Acquisition is a reference for presentation, ratio aggregation and quality
indicators only. Do not import its credentials, event mappings, product IDs,
campaign naming rules, short-link registry, or time corrections.

- Media APIs own spend, impressions and clicks at a single daily fact grain.
  Do not add Adjust cost to media cost or sum account/campaign/adgroup copies.
- Adjust owns attributed installs and configured conversion/revenue metrics.
  Registration and purchase events must already reach Adjust from the product.
  Connecting the reporting API cannot create missing product instrumentation.
- Product-specific behavior can be added only when that product sends a
  corresponding Adjust event. Missing metrics stay unavailable, not zero.
- Raw events and aggregate report rows are different facts. Never synthesize
  ConversionEvent records from aggregated Adjust metrics.

## Metric Definitions

| Metric | Required evidence |
| --- | --- |
| Spend, impressions, clicks | Media daily facts, currency and reporting timezone |
| Installs | Adjust attributed installs, attribution mode and app identity |
| Registrations and CPA | Configured registration metric with known count/user semantics; spend from matching dimensions and window |
| Paying users and CPP | A matching unique-payer metric; purchase event count and subscription activations are not substitutes |
| Revenue and ROAS | Explicit IAP/subscription/ad-revenue selection, currency, gross/net definition, cohort anchor and window |
| Net-profit ROI | Not available from advertising spend and revenue alone; requires the other business costs and adjustments |

Recompute ratios from matched additive operands. Never average row-level CPA
or ROAS. Do not sum daily unique users to claim range-wide unique users; query
the required reporting period and a compatible provider metric. Keep calendar
revenue separate from cohort revenue, and define renewals/refunds explicitly.

Adjust's documented cohorts start at install or reattribution, not registration.
Its D0 is the first 24 hours; a cumulative D6 covers the first seven days.
Do not relabel an Adjust D7 metric as registration-based 168-hour ROAS. Exact
registration cohorts require suitable timestamped raw Adjust data and stable
identity, plus separate ingestion work; the aggregate API alone is insufficient
evidence for that definition. See [How cohorts work](https://help.adjust.com/en/article/how-cohorts-work).

The report API's `cohort_maturity=mature` can return zeros for immature cohorts.
Persist/derive maturity separately so an unavailable window is not a true zero.
Pin attribution source, reattribution inclusion, currency and timezone rather
than relying on account defaults. Keep SKAdNetwork and other attribution views
separate unless an explicit non-overlapping reconciliation is verified. See the
[JSON report contract](https://dev.adjust.com/en/api/rs-api/reports/).

## Adex-Owned Configuration

For each product, resolve its Adjust app identifiers, media account/campaign
IDs, available registration/payment event metrics, revenue scope, currency,
timezone and attribution/cohort definition. These are product-specific values,
not copied acquisition settings. Secrets remain in the existing credential
store; documentation, fixtures and ordinary configuration must not contain them.

Discover actual metric IDs using Adjust's [Events endpoint](https://dev.adjust.com/en/api/rs-api/events/)
and [Filters Data endpoint](https://dev.adjust.com/en/api/rs-api/filters-data/).
An event token is not necessarily a Report Service metric slug. Availability
must be verified for the connected account and app, not guessed from labels.

Join only compatible facts using product/app, media platform, account/campaign
IDs and reporting period. Include OS/country only when both sources support
those dimensions. Never copy one campaign's total cost into every OS/product
slice. Missing IDs stay unmatched; names are display labels, not join keys.

## Implemented Local Setup

- `/settings/adjust` connects a Report Service API token, discovers accessible
  apps/events, and saves a separate configuration for each app. Luddi and
  Cuddler are the first intended live acceptance targets, not preconfigured
  production app IDs. Connecting an account is not an OAuth login flow.
- New credentials use authenticated encryption. Fixed official endpoints,
  workspace-scoped access and admin-only connection/configuration avoid an
  arbitrary URL credential forwarder. Tokens are never returned to the UI.
- Preview and sync retain raw network/partner and media IDs, then classify
  organic, known paid, explicitly mapped other, or unknown traffic. Conflicts
  and unmapped sources remain unknown; exact per-app overrides are supported.
- Event count, unique-user and revenue semantics require explicit confirmation.
  Missing mappings/values stay unavailable. Provider app-wide totals are queried
  separately rather than summing dimension-level unique users.
- `AdjustReportSnapshot` stores one latest successful requested-window report
  per configured app. Repeat sync replaces it; provider failures retain it;
  changed configuration marks it stale. This is not a daily fact warehouse.
- Configured apps bypass legacy Adjust account-report writes in manual/daily
  sync. Automatic sync is opt-in and uses the latest seven complete dates in
  each app's configured fixed UTC offset. No scheduler was activated.

See [local validation and release gates](../agent/adjust-setup-validation.md).

## Remaining Gaps

- Migration, database integration tests and real account reconciliation remain
  unverified locally. Catalog availability and selected metric semantics must
  be checked against the actual Luddi/Cuddler accounts before trusting metrics.
- The new report does not yet join media costs or calculate matched CPA, CPP,
  or ROAS. Independent daily facts, cohort windows and historical snapshots
  remain follow-up work; do not treat the latest-window snapshot as those facts.
- Unconfigured legacy Adjust connections retain their existing rolling account
  snapshot path. No historical rows were reinterpreted or backfilled.
- `growth/adjust-ingest.ts` currently emits zero revenue and uses a callback
  user key that can change after registration. It is not an Adjust-only payment
  or registration-cohort implementation.
- Existing growth snapshots can mix GA4/RevenueCat/Adjust events, lack complete
  product separation, and have their own historical UTC-day revenue windows.
  Do not expose them as newly validated Adjust-only metrics or silently backfill
  them with a different meaning.
- Existing media writers do not provide every matching dimension (notably OS)
  or a complete currency contract. Fine-grained matched costs may be unavailable.
- `getCohortReport` retains a legacy metric selection. No claim is made that it
  supplies configured registration metrics or the required cumulative windows.

## Integration Acceptance Gate

Before enabling the new source mode, use sanitized fixtures based on the target
app's available fields, then an explicitly authorized read-only reconciliation:

1. Verify event availability, unique-user semantics, app/account/campaign IDs,
   timezone, currency, attribution settings and revenue scope.
2. Persist independent daily media and Adjust aggregate facts with idempotent
   keys; query them without multiplying spend or mixing legacy event snapshots.
3. Test missing mappings, unmatched dimensions, currency mismatch, immature
   windows, unknown values, provider errors and repeated synchronization.
4. Reconcile a fixed mature date range with both source dashboards, including
   unmatched totals and freshness. Do not equate a connected account or HTTP
   200 with correct registrations, payer counts or revenue.

No live Adjust queries, real credentials or production writes were used.
A local additive schema/migration is prepared but has not been applied to a
database. API documentation was checked on 2026-09-24.
