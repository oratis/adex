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
    },
  },
})
