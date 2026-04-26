<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version (Next.js 16) has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> This file provides context for Claude Code sessions working on the adex project.

## Project Overview

Adex (adexads.com) is an AI-powered ad placement and creative automation platform. Marketers connect ad accounts (Google Ads with MCC, Meta, TikTok, AppsFlyer, Adjust, Amazon, LinkedIn), generate creative assets with AI (Seedance2 video, Seedream image), sync performance data, and orchestrate campaigns from a single dashboard.

Built on Next.js 16 (App Router, Turbopack, standalone), deployed on Google Cloud Run with Cloud SQL Postgres + GCS.

## Repo Layout (single app, NOT a monorepo)

```
src/
  app/
    (auth)/                 # login, register, password reset (public)
    (dashboard)/            # authed UI routes — guarded by server-side cookie
    api/                    # all server routes
      admin/                # admin console endpoints
      ads, advisor, assets, budgets, campaigns, creatives
      auth/                 # cookie session + OAuth callbacks
      cron/                 # daily digest + sync trigger (CRON_SECRET-gated)
      digest, google-ads, orgs, platforms, reports
      seedance2/            # AI video generation (doubao-seedance-2-0)
      settings/
    layout.tsx, page.tsx
    globals.css
  components/               # shared React components
  generated/                # Prisma client output
  lib/                      # business logic + infra
    audit.ts                # audit-log writer
    auth.ts                 # signed-cookie session helpers (HMAC-SHA256)
    backup.ts               # DB backup helpers
    i18n.ts                 # translations
    llm.ts                  # Anthropic Claude client (Advisor + ad copy)
    mailer.ts               # nodemailer (digest emails)
    prisma.ts               # Lazy PrismaClient with pg.Pool adapter
    rate-limit.ts           # in-memory rate limiter
    storage.ts              # GCS upload/delete via REST + ADC
    utils.ts
    webhooks.ts
    platforms/              # external API clients per platform
  middleware.ts             # Next.js proxy/middleware (auth gate)
prisma/
  schema.prisma             # PostgreSQL schema
  migrations/               # `prisma migrate` artefacts
  seed.ts                   # demo seed data
e2e/
  smoke.spec.ts             # Playwright smoke test
docs/
  agent/                    # operational docs (extend as needed)
.github/workflows/
  ci.yml                    # lint + tsc + next build on push/PR
  e2e.yml                   # Playwright tests
```

Package manager: **npm** (not pnpm).

## Key Technologies

- **Next.js 16.2** — App Router, `middleware.ts` (NOT `proxy.ts`), Turbopack, `output: "standalone"`
- **React 19.2**
- **Prisma 7** — schema at `prisma/schema.prisma`, client uses `@prisma/adapter-pg` against PostgreSQL 16
- **Auth** — HMAC-SHA256 signed session cookies (custom, see `src/lib/auth.ts`). NextAuth v4 dependency exists but **the runtime auth is custom-cookie**, NOT NextAuth — don't confuse the two
- **bcrypt** — password hashing
- **Tailwind CSS 4** — `@theme` block in `globals.css`
- **Playwright 1.59** — only e2e tests at this time (no Vitest/Jest yet)
- **Anthropic Claude** — Advisor + ad-copy generation when `ANTHROPIC_API_KEY` is set; rule-based fallback otherwise

## Critical Rules

### No Local Database _(enforced by hook: pre-bash.sh)_
Don't spin up local Postgres via `docker-compose up`. The dev DB is the local SQLite (`dev.db` / `prisma/test.db`) for offline iteration; production DB is Cloud SQL via `DATABASE_URL`.

### Persistence-First Architecture
- No SQLite, no local-disk state in production. Cloud SQL + GCS only — Cloud Run cold starts must never lose data.
- API responses are validated (`res.ok` + `Array.isArray`) before being rendered. Failed external sync → banner, not white screen.
- Lazy Prisma client (`src/lib/prisma.ts`) returns a `Proxy` when `DATABASE_URL` is unset, so `next build` page-data collection works without a live DB.

### basePath `/adex` Awareness
- All routes are mounted under `/adex` when `NEXT_PUBLIC_BASE_PATH=/adex` (shared-domain deployment).
- Empty / unset basePath = root deploy (own domain).
- Hardcoded URLs MUST use the basePath helper or `process.env.NEXT_PUBLIC_BASE_PATH` — don't bake `/adex` into strings.

### Schema Safety _(enforced by hooks: pre-schema-edit.sh, post-schema-edit.sh)_
1. Destructive operations on `prisma/schema.prisma` (drop model, remove field, full-file rewrite) require human confirmation.
2. After any schema change: `npx prisma generate` AND create a migration with `npx prisma migrate dev --name <description>`.
3. Production DBs use `npx prisma migrate deploy` at container start (`start.sh`).
4. Never edit the migration files after they've been deployed — make a new migration instead.

### Commit Message Format _(enforced by hook: pre-commit-gate.sh)_
Two formats are accepted:

**Conventional**: `type(scope): summary`
- `type`: feat / fix / refactor / perf / style / docs / test / chore / revert
- `scope`: app / api / db / ui / auth / platform / advisor / cron / deploy / migration (comma-separated for multi-area)
- `summary`: lowercase start, no trailing period, ≤72 chars

**Phase**: `Phase N: short summary` — used historically for milestone commits (allowed for backwards compat).

Body is optional. Use `WHY:` / `WHAT:` labels in body if helpful. Footer: `Closes #N`, `BREAKING: ...`.

### Tests for New Business Logic _(soft-enforced by hook: stop-check-tests.sh)_
There is currently NO unit-test framework installed — only Playwright e2e (`e2e/smoke.spec.ts`).
- New API routes / lib modules with non-trivial logic should ship with at least an e2e smoke covering the happy path.
- The hook reminds (warns, does not block) when a new `src/app/api/**/route.ts` lands without an updated e2e spec.
- Pure UI components, type definitions, and config files are exempt.

If you'd benefit from unit tests, propose adding Vitest in a separate PR — don't bolt it on inside a feature.

### Never Remove Code Without Asking
When deploying or fixing build errors, if you discover new data structures (Prisma models, DB tables), API endpoints, or route files that were added by another developer or another Claude session — **DO NOT delete or modify them**. Ask the user first. These additions may be intentional work from a parallel session.

This applies to:
- New `route.ts` files in `src/app/api/`
- New Prisma models or fields in `schema.prisma`
- New components, lib files, or migration files
- New environment variables in `.env.example`

If a build fails due to a type error involving new code, fix the type error — don't remove the new code.

## Important Conventions

### Next.js 16 Breaking Changes
Read `node_modules/next/dist/docs/` before writing Next.js code. Don't assume training-data patterns hold. Notable for adex: `middleware.ts` is still the entry (not `proxy.ts`) but several APIs around metadata/route handlers have shifted.

### Auth Architecture
- **Custom signed cookies**, not NextAuth runtime. `src/lib/auth.ts` exposes `getSession()` / `setSession()` / `clearSession()` using HMAC-SHA256 over `AUTH_TOKEN_SECRET`.
- Server-side guard at `src/app/(dashboard)/layout.tsx` redirects to `/login` when no valid session.
- Passwords hashed with `bcrypt` (Phase 9). Sessions can be revoked by bumping a per-user version field.
- `next-auth` is in `package.json` for `@auth/prisma-adapter`'s peer dep + future migration — but is NOT wired up.

### Multi-Tenant Orgs
- Every business object has an `organizationId` foreign key.
- `OrgMembership` (role: owner/admin/member) gates per-org access.
- `OrgInvite` handles email invites with accept-token URLs.
- Helpers in route handlers must filter by current user's org — never trust client-supplied `organizationId`.

### Platform Integrations
- OAuth tokens live in `PlatformAuth` (per user/org, per platform). Refresh tokens kept; Google flow forces `prompt=consent` so a refresh token always issues.
- Each `src/lib/platforms/<provider>.ts` exposes a thin client. Failures should be caught at the route handler — surface as banner, never let them crash the dashboard.
- "Sync Data" button in dashboard → `POST /api/reports/sync` pulls all configured platforms in parallel; metrics persist to `Report` rows.

### Cron + Daily Digest
- `POST /api/cron/daily` requires `CRON_SECRET` bearer token. Run via Cloud Scheduler / Kubernetes CronJob.
- Generates `DailyDigest` rows, sends via SMTP (nodemailer) when SMTP env is set; falls back to DB-only otherwise.
- Optional LLM-written executive summary when `ANTHROPIC_API_KEY` is set.

### Audit Log
- `AuditEvent` model captures `{ userId, orgId, action, target, meta }` for security-relevant ops.
- All admin actions, OAuth connect/disconnect, role changes, and bulk asset deletes MUST call `logAudit()` from `src/lib/audit.ts`.

### GCS Upload
- `src/lib/storage.ts` uses REST API + ADC token (metadata server on Cloud Run, `GOOGLE_ACCESS_TOKEN` for local).
- Uploaded files served from GCS public URL — there's no proxy rewrite layer (unlike Luddi). Configure bucket public-read or signed URLs as needed.

## Common Commands

```bash
# Local dev (port 3000)
npm run dev

# Generate Prisma client after schema changes
npx prisma generate

# Migrate local dev DB
npx prisma migrate dev --name <description>

# Apply migrations to production DB
DATABASE_URL=... npx prisma migrate deploy

# Lint + type-check
npm run lint
npx tsc --noEmit

# Build (also catches runtime regressions in route handlers)
npm run build

# Playwright e2e
npm run test:e2e

# Seed demo data
npm run db:seed
```

## Deployment — Google Cloud Run

```bash
# Build & push
gcloud builds submit --tag gcr.io/YOUR_PROJECT/adex

# Deploy
gcloud run deploy adex \
  --image gcr.io/YOUR_PROJECT/adex \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE \
  --set-env-vars "DATABASE_URL=postgresql://...,GCS_BUCKET=...,..."
```

- The Cloud Run service account needs `roles/storage.objectAdmin` on the GCS bucket and `roles/cloudsql.client` for Cloud SQL.
- **Prisma Migrate doesn't parse Cloud SQL Unix-socket DSN** — use the public IP DSN at runtime, with the instance allow-listed for the Cloud Run egress range (or a connector).
- `start.sh` runs `prisma migrate deploy` before booting the standalone server. CI calls `next build` to catch regressions before deploy.

## Environment Variables
Full list in `.env.example`. Critical ones:
- `DATABASE_URL` — Postgres DSN
- `AUTH_TOKEN_SECRET` — HMAC secret for cookie signing (REQUIRED in prod)
- `GCS_BUCKET` — upload destination
- `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` / `GOOGLE_ADS_REDIRECT_URI`
- `SEEDANCE2_API_KEY` — AI video generation
- `ANTHROPIC_API_KEY` — Advisor + ad copy
- `SMTP_*` + `MAIL_FROM` — daily digest delivery
- `CRON_SECRET` — bearer for `/api/cron/*`
- `NEXT_PUBLIC_BASE_PATH` — `""` or `/adex`

## File Locations — Quick Reference

| What | Where |
|------|-------|
| Auth helpers (signed cookies) | `src/lib/auth.ts` |
| Prisma client (lazy proxy) | `src/lib/prisma.ts` |
| GCS storage | `src/lib/storage.ts` |
| LLM client (Claude) | `src/lib/llm.ts` |
| Audit log | `src/lib/audit.ts` |
| Mailer (nodemailer) | `src/lib/mailer.ts` |
| Webhooks | `src/lib/webhooks.ts` |
| Rate limiter | `src/lib/rate-limit.ts` |
| Platform clients | `src/lib/platforms/*.ts` |
| Middleware (auth gate) | `src/middleware.ts` |
| Dashboard layout (auth check) | `src/app/(dashboard)/layout.tsx` |
| Schema | `prisma/schema.prisma` |
| Migrations | `prisma/migrations/` |
| Seed | `prisma/seed.ts` |
| Next config (basePath) | `next.config.ts` |
| Container entrypoint | `start.sh` |
| Dockerfile | `Dockerfile` |
| CI | `.github/workflows/ci.yml`, `.github/workflows/e2e.yml` |

## Known Issues

- **No unit tests yet** — only Playwright e2e smoke. New business logic is reviewed manually; consider adding Vitest in a future phase.
- **bcrypt + Cloud Run** — bcrypt has a native binding; Docker build uses `node:20-bullseye-slim` to avoid Alpine glibc issues. Don't switch the base image to alpine.
- **next-auth peer-dep** — `@auth/prisma-adapter` is installed but the runtime auth is custom-cookie. Don't try to "wire up" NextAuth without an explicit plan.
- **Prisma adapter for pg** — must initialise `pg.Pool` lazily; eager init breaks `next build`.
- **Cloud SQL DSN format** — Unix-socket form is rejected by Prisma Migrate. Use public IP + allow-list at deploy time.
- **basePath leak risk** — anywhere a URL is constructed by hand instead of via Next's `Link`/router, it must read `NEXT_PUBLIC_BASE_PATH`. Audit before adding new outbound links.

## Session Safety
See `.claude/rules/session-safety.md`.

## Schema Workflow
See `.claude/rules/schema.md`.

## Testing Conventions
See `.claude/rules/testing.md`.
