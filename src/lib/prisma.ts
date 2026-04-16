import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function parseDatabaseUrl(url: string) {
  // Handle Cloud SQL Unix socket format: postgresql://user:pass@/dbname?host=/cloudsql/...
  const parsed = new URL(url)
  const socketHost = parsed.searchParams.get('host')
  return {
    host: socketHost || parsed.hostname,
    port: socketHost ? undefined : parseInt(parsed.port || '5432'),
    database: parsed.pathname.slice(1) || 'adex',
    user: parsed.username || 'postgres',
    password: decodeURIComponent(parsed.password || ''),
  }
}

function createPrismaClient() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    // Return a client that will throw on first use — safe during build
    return new Proxy({} as PrismaClient, {
      get(_target, prop) {
        if (prop === 'then') return undefined // not a promise
        throw new Error(`DATABASE_URL is not set. Cannot use Prisma client.`)
      },
    })
  }
  const config = parseDatabaseUrl(dbUrl)
  const pool = new pg.Pool(config)
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma || createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
