import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Tests must not import or hit Prisma; we only test pure functions and
    // adapters with mocked fetch. Anything that needs a real DB belongs in
    // playwright (see e2e/).
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
