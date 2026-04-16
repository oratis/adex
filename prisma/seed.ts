import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import crypto from 'crypto'

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex')
}

function parseDatabaseUrl(url: string) {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '5432'),
    database: parsed.pathname.slice(1),
    user: parsed.username,
    password: decodeURIComponent(parsed.password),
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || ''
  const config = parseDatabaseUrl(dbUrl)
  const pool = new pg.Pool(config)
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  // Seed default user
  const email = 'oratis@hakko.ai'
  const password = 'hakko2024'

  const existing = await prisma.user.findUnique({ where: { email } })
  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        password: hashPassword(password),
        name: 'Oratis',
      },
    })
    console.log(`Created user: ${email}`)
  } else {
    console.log(`User already exists: ${email}`)
  }

  await prisma.$disconnect()
}

main().catch(console.error)
