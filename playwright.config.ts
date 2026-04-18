import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PORT || '3000'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],
  use: {
    // baseURL is the origin only; each test prefixes paths with /adex itself
    // (see the `p` helper in test files). This avoids URL-resolution quirks
    // when baseURL has a path segment.
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
    url: `http://localhost:${PORT}/adex/login`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      AUTH_TOKEN_SECRET: 'e2e-test-secret-do-not-use-in-production',
    },
  },
})
