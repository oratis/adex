# Glob: e2e/**/*.spec.ts, src/**/*.test.ts, src/**/*.test.tsx

## Testing Conventions

| Layer | Framework | Location | Status |
|-------|-----------|----------|--------|
| End-to-end | **Playwright 1.59** | `e2e/*.spec.ts` | active |
| Unit / integration | _(none)_ | — | not yet adopted |

The repo currently has only Playwright e2e (`e2e/smoke.spec.ts`). New business logic should ship with at least an extended e2e spec. **Don't add Vitest/Jest inline inside a feature** — propose adding a unit-test framework as a separate PR with explicit user buy-in.

## Playwright basics

- Config: `playwright.config.ts`
- Run: `npm run test:e2e`
- Install browsers: `npm run test:e2e:install`
- Debug: `npx playwright test --headed --debug`
- Last report: `npx playwright show-report`

## basePath in tests

The app's basePath is configurable via `NEXT_PUBLIC_BASE_PATH` (`""` or `/adex`). When writing specs:
- Read `process.env.PLAYWRIGHT_BASE_URL` (or rely on `baseURL` in `playwright.config.ts`)
- Don't hardcode `http://localhost:3000/adex` — use relative paths

## Auth in tests

Auth is HMAC-signed cookies (NOT NextAuth). Two patterns work:

1. **Programmatic login** (preferred):
   ```ts
   const res = await page.request.post('/api/auth/login', {
     data: { email: 'demo@adex.dev', password: 'demo1234' },
   });
   await page.context().storageState({ path: 'auth.json' });
   ```
   Reuse `auth.json` across tests via `test.use({ storageState: 'auth.json' })`.

2. **Pre-signed cookie injection**: only if you need to bypass the password flow. Sign with `AUTH_TOKEN_SECRET` matching the runtime helper in `src/lib/auth.ts`.

Phase 9 added bcrypt + session revocation, so signing-by-hand can drift from the runtime — pattern 1 is more robust.

## Soft test-coverage reminder _(stop-check-tests.sh)_

When a new `src/app/api/**/route.ts` or `src/lib/**.ts` (excluding infra wrappers) is staged without an updated `e2e/*.spec.ts`, the Stop hook prints a reminder. It does NOT block the commit — coverage is on you.

## Don't mock the database

adex e2e specs talk to a real Postgres (CI service container) or to `prisma/test.db` SQLite for offline runs. Don't add Prisma mocks — they drift from real schema behaviour.
