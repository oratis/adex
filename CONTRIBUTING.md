# Contributing to Adex

Thanks for your interest! Adex is a small, opinionated project — we keep the contribution loop tight so that most PRs land within days.

## Quick start

```bash
git clone https://github.com/oratis/adex.git
cd adex
npm install
cp .env.example .env
# edit .env — at minimum DATABASE_URL, AUTH_TOKEN_SECRET
npx prisma generate
npx prisma migrate deploy
npm run dev
```

Open <http://localhost:3000/login> — the `/adex` basePath is now optional. To run under `/adex` (for a subpath deployment), set `NEXT_PUBLIC_BASE_PATH=/adex` in `.env`.

## Before opening a PR

1. **Type-check**: `npx tsc --noEmit` — must pass with zero errors.
2. **Lint**: `npm run lint` — warnings are OK, errors are not.
3. **Build**: `npm run build` — catches regressions the IDE misses.
4. **E2E smoke**: `npm run test:e2e` — 14 smoke tests, <10s on my laptop. Add one if your change touches auth, routing, or critical UI.
5. **Migration**: if you change `prisma/schema.prisma`, add a matching SQL migration under `prisma/migrations/` and update any relevant helper.

## PR structure

- **One topic per PR.** Two unrelated changes → two PRs.
- **Commit messages**: imperative mood, concise summary line, then a body that answers *why*. See the existing git log for the house style.
- **If you add or change an env var**, update `.env.example` in the same PR.
- **If you add a route that performs a consequential action** (launch, delete, invite, apply), add a `logAudit()` call with an action key you've added to `AuditAction` in `src/lib/audit.ts`.
- **If you add a new scoped resource** (anything keyed on orgId), make sure its API route uses `requireAuthWithOrg()` and filters by `orgId`.

## Project structure

```
src/
  app/
    (auth)/          # login, register, forgot-password, reset-password
    (dashboard)/     # auth-guarded pages
    api/             # route handlers
  components/        # shared UI
  lib/
    auth.ts          # session signing, org helpers, role checks
    audit.ts         # logAudit()
    prisma.ts        # lazy Prisma client
    storage.ts       # GCS upload/delete
    rate-limit.ts    # fixed-window in-memory limiter
    llm.ts           # Anthropic API wrapper
    mailer.ts        # nodemailer SMTP sender
    platforms/       # one file per external API (google, meta, tiktok, ...)
prisma/
  schema.prisma
  migrations/
e2e/                 # Playwright smoke tests
```

## Adding a new ad platform

1. Create a client in `src/lib/platforms/<name>.ts` — one class with `getReport(startDate, endDate)` and whatever operations you plan to call.
2. Add a branch in `src/app/api/reports/sync/route.ts` that calls your client and maps its response to `SyncMetrics`.
3. Add `<name>` to the `PLATFORMS` array in `src/app/(dashboard)/settings/page.tsx` so users can configure credentials.
4. If the platform has OAuth, follow the pattern in `src/app/api/auth/google/`.

## Areas that welcome contributions

- **More platform integrations** — currently Google Ads, Meta, TikTok, AppsFlyer, Adjust are wired. Amazon Ads, LinkedIn Ads, Microsoft Ads would all fit the existing pattern.
- **Internationalization** — `src/lib/i18n.ts` has en + zh; keys for more pages would help. Contributions welcome for other languages.
- **E2E coverage** — authenticated flows (login → create campaign → sync data).
- **Observability** — a cheap Sentry / OTel drop-in.
- **Webhooks** — outgoing webhooks for significant events (campaign launched, budget hit, etc.).

## Questions & discussions

Open an issue. For security reports, see [SECURITY.md](./SECURITY.md).

## License

By contributing you agree your work is released under the [MIT License](./LICENSE).
