# Adex

AI-powered ad placement and creative automation platform. Adex helps marketers connect ad accounts (Google Ads, with more platforms planned), generate creative assets with AI (image, video, audio via Seedance2), sync performance data, and orchestrate campaigns from a single dashboard.

Built on Next.js 16 with the App Router, deployed on Google Cloud Run with Cloud SQL Postgres and Google Cloud Storage for persistent state.

## Features

- **Multi-platform ad account auth** — OAuth2 for Google Ads (MCC supported), token-based config for Meta, TikTok, AppsFlyer, Adjust
- **Unified performance sync** — One "Sync Data" button pulls metrics from Google Ads, Meta, TikTok, AppsFlyer and Adjust into Postgres; dashboard always reads from DB so transient API failures never crash the UI
- **7-day trend chart** — Dependency-free SVG line chart with spend-by-platform overlay
- **AI Advisor** — Powered by Claude (Anthropic API) when `ANTHROPIC_API_KEY` is set; falls back to rule-based recommendations otherwise (low ROAS, low CTR, high CPA, scale opportunities)
- **AI creative generation** — Seedance2 (doubao-seedance-2-0) for text2video/image2video, plus `/api/creatives/generate-copy` for LLM-written headline/description/CTA variants
- **Campaign + Creative + Budget CRUD** — Edit, pause/resume, delete; attach creatives to campaigns (auto-creates default ad group)
- **Asset library** — Upload to Google Cloud Storage, folder browsing, multi-select with bulk delete/tag, Google Drive sync
- **Daily digest email** — Nightly performance summary via SMTP (nodemailer); optional LLM-generated executive summary
- **Signed session cookies** — HMAC-SHA256 session tokens with TTL; server-side auth guard on dashboard routes

## Tech Stack

- **Frontend / API**: Next.js 16.2 (App Router, Turbopack, standalone output), React 19, Tailwind
- **Database**: PostgreSQL 16 (Cloud SQL) via Prisma 7 with `@prisma/adapter-pg`
- **Storage**: Google Cloud Storage (REST API + ADC token from metadata server)
- **Hosting**: Google Cloud Run (containerized, basePath `/adex`)
- **AI**: Seedance2 (doubao-seedance-2-0) for video; pluggable provider layer

## Quick Start (local)

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env
# edit .env — at minimum set DATABASE_URL pointing at any Postgres instance

# 3. migrate
npx prisma migrate deploy

# 4. run
npm run dev
```

Open <http://localhost:3000/adex>.

For local file uploads to GCS, either run with Application Default Credentials (`gcloud auth application-default login`) or set `GOOGLE_ACCESS_TOKEN` in `.env`.

## Deployment to Google Cloud Run

The repo includes a production-ready `Dockerfile` and `start.sh` (runs `prisma migrate deploy` then boots the standalone server).

```bash
# Build & push
gcloud builds submit --tag gcr.io/YOUR_PROJECT/adex

# Deploy (set env vars via --set-env-vars or Secret Manager)
gcloud run deploy adex \
  --image gcr.io/YOUR_PROJECT/adex \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE \
  --set-env-vars "DATABASE_URL=postgresql://...,GCS_BUCKET=...,..."
```

Notes:
- The Cloud Run service account needs `roles/storage.objectAdmin` on the GCS bucket and `roles/cloudsql.client` for Cloud SQL.
- Prisma Migrate does not parse the Cloud SQL Unix-socket DSN format — use the public IP DSN at runtime, with the instance allow-listed for the Cloud Run egress range (or use a connector).

## Project Structure

```
src/
  app/
    (dashboard)/         # authed UI routes (basePath /adex)
    api/
      assets/            # asset CRUD + GCS upload
      auth/google/       # OAuth2 connect for Google Ads
      reports/sync/      # pull metrics into DB
      seedance2/         # AI video generation
  lib/
    prisma.ts            # PrismaClient with pg.Pool adapter, lazy init
    storage.ts           # GCS upload/delete via REST + ADC
    auth.ts              # cookie session helpers
    platforms/           # external API clients (google-ads, seedance2, ...)
prisma/
  schema.prisma          # PostgreSQL schema
  migrations/
```

## Architecture Notes

- **Persistence first.** No SQLite, no local disk for user data. Everything goes to Cloud SQL or GCS so a Cloud Run cold start never loses anything.
- **Crash-safe dashboard.** API responses are validated (`res.ok` + `Array.isArray`) before being rendered. A failed external sync surfaces as a banner, not a white screen.
- **Lazy Prisma client.** `src/lib/prisma.ts` returns a `Proxy` when `DATABASE_URL` is unset, so Next.js build-time page-data collection doesn't need a live DB.
- **basePath `/adex`.** All routes are mounted under `/adex` to coexist with sibling apps on the same domain.

## Security

- Don't commit `.env`. The repo's `.env.example` documents every variable.
- OAuth tokens are stored in the `PlatformAuth` table (per user, per platform). Refresh tokens are kept; the callback flow forces `prompt=consent` so a refresh token is always issued.
- Hardcoded keys / URLs have been scrubbed — all secrets come from environment.

## Continuous Integration

Every push and PR to `main` runs a GitHub Actions workflow that:

1. installs dependencies with `npm ci`
2. runs `prisma generate`
3. runs `eslint` + `tsc --noEmit`
4. runs `next build` to catch runtime-level regressions

See `.github/workflows/ci.yml`.

## License

[MIT](./LICENSE) © 2026 Oratis
