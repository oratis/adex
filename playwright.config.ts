import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PORT || '3000'
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}${BASE_PATH}/login`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      AUTH_TOKEN_SECRET: 'e2e-test-secret-do-not-use-in-production',
      // Fall back to the same testing-only values the specs themselves fall back
      // to (e2e/competitor-ingest.spec.ts, e2e/remix-jobs.spec.ts) — without this,
      // a runner that sets the secrets in its own env (to un-skip the DB-backed
      // specs) but not here would sign requests the dev server can't verify.
      WORKER_WEBHOOK_SECRET: process.env.WORKER_WEBHOOK_SECRET || 'e2e-worker-secret',
      INGEST_WEBHOOK_SECRET: process.env.INGEST_WEBHOOK_SECRET || 'e2e-competitor-ingest-secret',
      // e2e runs with every tier open so 400-path coverage exercises t1/t2 —
      // the shipped default (unset) stays 't0_5' only, see remix-job.ts.
      REMIX_ENABLED_TIERS: 't0_5,t1,t2',
    },
  },
})
