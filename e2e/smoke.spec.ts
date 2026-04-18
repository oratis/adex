/**
 * E2E smoke tests — verify public pages render and auth-gated routes
 * redirect correctly. These do NOT require a live database (auth checks
 * short-circuit before DB access for unauthenticated users).
 */
import { test, expect } from '@playwright/test'

// App basePath is configurable — default to '' (root). Tests run in both
// contexts. Helper prefixes a leading slash if missing.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''
const p = (path: string) =>
  `${BASE_PATH}${path.startsWith('/') ? path : '/' + path}`

test.describe('public pages', () => {
  test('login page renders with form', async ({ page }) => {
    await page.goto(p('/login'))
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /forgot/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /register/i })).toBeVisible()
  })

  test('register page shows password-mismatch warning', async ({ page }) => {
    await page.goto(p('/register'))
    await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible()

    // Two password inputs — the second is the confirmation
    const pwInputs = page.locator('input[type="password"]')
    await pwInputs.nth(0).fill('longenoughpw')
    await pwInputs.nth(1).fill('different')
    await expect(page.getByText(/passwords do not match/i)).toBeVisible()
  })

  test('forgot password page renders', async ({ page }) => {
    await page.goto(p('/forgot-password'))
    await expect(page.getByRole('heading', { name: /forgot password/i })).toBeVisible()
  })

  test('reset password page handles missing token', async ({ page }) => {
    await page.goto(p('/reset-password'))
    await expect(page.getByText(/missing reset token/i)).toBeVisible()
  })
})

test.describe('auth guard', () => {
  const protectedRoutes = [
    '/dashboard',
    '/campaigns',
    '/creatives',
    '/budget',
    '/assets',
    '/settings',
    '/advisor',
    '/seedance2',
  ]

  for (const route of protectedRoutes) {
    test(`${route} redirects unauthenticated users to /login`, async ({ page }) => {
      await page.goto(p(route))
      await expect(page).toHaveURL(new RegExp(`${BASE_PATH.replace(/\//g, '\\/')}\\/login$`))
    })
  }
})

test.describe('theme persistence', () => {
  test('localStorage adex.theme controls <html> .dark class', async ({ page }) => {
    await page.goto(p('/login'))
    // Force dark, reload
    await page.evaluate(() => localStorage.setItem('adex.theme', 'dark'))
    await page.reload()
    const hasDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    )
    expect(hasDark).toBe(true)

    // Force light, reload
    await page.evaluate(() => localStorage.setItem('adex.theme', 'light'))
    await page.reload()
    const stillDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    )
    expect(stillDark).toBe(false)
  })
})

test.describe('rate limiting', () => {
  test('login endpoint returns 429 after 10 rapid attempts', async ({ request }) => {
    // Hit login 12 times in a row — should see 429 before attempt 12.
    let got429 = false
    for (let i = 0; i < 12; i++) {
      const res = await request.post(p('/api/auth/login'), {
        data: { email: 'rate-limit-test@example.com', password: 'wrong' },
      })
      if (res.status() === 429) {
        got429 = true
        // Verify Retry-After header is present
        expect(res.headers()['retry-after']).toBeTruthy()
        break
      }
    }
    expect(got429).toBe(true)
  })
})
