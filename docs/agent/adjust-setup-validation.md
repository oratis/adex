# Adjust Setup Validation

Date: 2026-09-24. Release branch `codex-mt/adjust-onboarding`, separated from
the broader report/model work. This document records pre-release verification;
live Adjust account acceptance remains pending the user's token and mappings.

The release includes the minimum signed-session boundary: raw user-ID cookies
are rejected before the new credential routes. Existing signed sessions remain
supported; old raw-ID sessions must log in again. Seedance model/ownership and
the broader dashboard metric changes are not part of this branch.

## Scope and Modules

The first intended live products are Luddi and Cuddler. Their production app
tokens and events are not known or guessed. The same connection can discover
both apps, with independent product association, metrics, source rules,
currency, fixed UTC offset and attribution settings. Acquisition configuration
and credentials are not imported.

- `src/lib/platforms/adjust.ts`: fixed Report Service transport and catalogs.
- `src/lib/reports/adjust-data.ts`: validation, traffic classification and
  normalization, with no database or network access.
- `src/lib/reports/adjust-service.ts`: workspace ownership, configuration and
  idempotent latest-window snapshot persistence.
- `src/lib/platform-credential.ts`: encrypted credential envelope.
- `src/app/api/adjust/`: connection, catalog, preview, save and sync routes.
- `src/components/adjust-setup.tsx` and `src/components/adjust/`: onboarding,
  metric/source configuration, filtered report and CSV export.
- `prisma/migrations/20260924114500_adjust_report_snapshot/migration.sql`:
  additive snapshot table; existing report/event records remain untouched.

The UI is at `/settings/adjust`, honoring the deployment basePath. APIs and
reports require a signed session and active workspace; connection, catalog,
preview and writes require owner/admin. Members can read saved reports.

## Acceptance Scenarios

1. Given an authorized workspace, connecting a valid token discovers apps;
   storage is encrypted and neither token nor ciphertext is returned by APIs.
2. Given two apps, each uses its own available metrics. A metric from the other
   app is rejected. Selected count/user/revenue semantics require confirmation.
3. Given organic, known paid, conflicting or unknown sources, normalization
   preserves raw labels/IDs and leaves ambiguity unknown. Exact per-app rules
   can override classification; unknown is never treated as organic.
4. Given a saved app, repeated sync replaces one snapshot. Provider failure
   preserves the last successful report, while a config change marks it stale.
5. Given a different workspace or anonymous caller, reject access before
   contacting the provider. Runtime test endpoint overrides reject production.
   Members cannot use either the dedicated or combined sync entry to bypass
   the Adjust write restriction.
6. Given an app's opt-in automatic sync, select seven complete reporting dates
   in that app's fixed UTC offset, not partially elapsed dates in another zone.

No Adjust spend is added to media spend. Dimension-level unique users are not
summed into app-wide totals. Missing metrics are null, not inferred zeros. This
report does not yet supply a daily warehouse or matched media CPA/CPP/ROAS.

## Local Verification

Working directory: `/Users/mt/.codex/worktrees/adjust-onboarding-release/adex`.

```sh
npm test
npx tsc --noEmit
npm run lint
env -u DATABASE_URL npx prisma generate
env -u DATABASE_URL npx prisma validate
env -u DATABASE_URL -u SEEDANCE2_API_KEY -u ANTHROPIC_API_KEY npm run build
env -u DATABASE_URL -u SEEDANCE2_API_KEY -u ANTHROPIC_API_KEY \
  -u WORKER_WEBHOOK_SECRET -u INGEST_WEBHOOK_SECRET PORT=3327 \
  npm run test:e2e -- --workers=2 --reporter=dot
```

- Focused Adjust tests: 42 passed in three files, including encryption,
  malformed/failed responses, classification, metrics and timezone boundaries.
- Timezone boundary test was observed failing before implementation, then
  passing. Negative validation changed the unknown-source fallback to organic:
  two tests failed; restoring the intended behavior passed.
- Prisma client generation and schema validation passed without a database.
- `env -u DATABASE_URL npx prisma migrate dev --name adjust_report_snapshot`
  failed because `datasource.url` is missing. No migration was applied.
- Scoped release unit run: 470 passed across 38 files, zero skipped. Type check
  and production build passed. Lint has zero errors and 35 existing warnings
  outside changed files; targeted lint of the final sync permission change
  also passed. `git diff --check` passed.
- Local full E2E run: 59 total, 25 passed and 34 skipped. Database-dependent
  cases, including all nine Adjust database cases, were skipped without
  `DATABASE_URL`. This is not a successful database integration run; the new
  member-permission and existing-user-cookie cases still require CI execution.

Browser QA used an isolated Ego Lite task with fictional API responses and a
temporary preview route, now removed. Desktop 1440x1000 and mobile 390x844
verified app switching, per-app events, preview, unknown-source filtering,
CSV download and preserving the report after a 502 failure. Mobile document
width was 390px; the report table scrolled within its container.

Artifacts: `/tmp/adex-adjust-qa-20260924/desktop.png`, `mobile.png`, `unknown.csv`.
These precede the final component extraction, semantic-confirmation checkbox
and CSV metadata additions. They validate interaction/layout with fixtures,
not actual provider data or final database integration.

## Database and Release Gates

The nine database E2E cases in `e2e/adjust-setup.spec.ts` use real Postgres and a
local HTTP provider, not mocked Prisma. They require the existing isolated CI
database with `REPORT_DB_TESTS=1` and `ADJUST_TEST_API_URL=http://127.0.0.1:3322`.
The latter is rejected when `NODE_ENV=production`; never deploy it. CI's
encryption key is fixture-only. The PR's checks must verify these cases before
merge; local no-database checks alone are insufficient.

The DB-backed UI case checks normalized preview values, cached-report access
when the provider catalog fails, saved metric labels and mobile overflow. It
records desktop/mobile screenshots under the workflow's `playwright-report`
artifact, including successful runs. Disconnect tests reject missing or
object-valued filters before any delete and preserve the connection for members.

Before release:

1. Pass the migration and full database E2E suite on an isolated test database.
2. Configure a stable `PLATFORM_CREDENTIAL_KEY` through the deployment secret
   manager: base64 of exactly 32 random bytes. Do not put its value in source,
   ordinary files or logs. Preserve it across revisions; key rotation requires
   a re-encryption/reconnection plan. Missing/invalid keys block new connections.
3. New/replaced Adjust credentials are AES-256-GCM encrypted with workspace
   binding. Legacy plaintext credentials remain readable for compatibility;
   they are not silently migrated. Reconnect them through the secure page.
4. After release, enter the Adjust Report Service API token only in the secure
   settings page. Select the actual Luddi and Cuddler apps; confirm registration
   count versus users, unique payers, revenue definition, currency, UTC offset
   and attribution settings. Missing unique-user metrics must remain unmapped.
5. Reconcile a fixed date window with Adjust's dashboard, including unknown
   source rows, zero/missing values, totals and provider warnings. Only then
   opt into existing daily sync. No new scheduler or live automatic run has
   been created/enabled by this change.

Fixed UTC offsets do not automatically follow daylight-saving transitions.
No custom external API URL import or Adjust OAuth account login is implemented.
Media-cost joins, durable daily history and cohort/maturity processing remain
separate work under [the reporting contract](../growth/07-media-adjust-reporting.md).

## Recovery

Before the first real Adjust credential is stored, reverting the Cloud Run
revision can leave the additive table and unused encryption key in place.
After encrypted credentials are stored, pre-feature clients cannot use them:
prefer a forward fix rather than blindly returning to the plaintext client.
Never rotate or delete the encryption key as part of a rollback.
