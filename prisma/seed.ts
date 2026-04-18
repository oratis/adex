import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcrypt'

/**
 * Seed a demo user + personal workspace + sample campaigns / budgets /
 * reports so first-time visitors see a populated dashboard.
 *
 * Run: `npm run db:seed` (no-op idempotent).
 */

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

const PLATFORM_COLORS: Record<string, { impressions: number; clicks: number; ctr: number; conversions: number; cpa: number; revenue: number }> = {
  google: { impressions: 120_000, clicks: 3_200, ctr: 2.67, conversions: 64, cpa: 42, revenue: 5400 },
  meta:   { impressions: 180_000, clicks: 2_800, ctr: 1.55, conversions: 50, cpa: 55, revenue: 3800 },
  tiktok: { impressions: 240_000, clicks: 4_100, ctr: 1.71, conversions: 38, cpa: 72, revenue: 2900 },
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || ''
  if (!dbUrl) {
    console.error('DATABASE_URL required')
    process.exit(1)
  }
  const pool = new pg.Pool(parseDatabaseUrl(dbUrl))
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  try {
    const email = process.env.SEED_EMAIL || 'demo@adexads.com'
    const password = process.env.SEED_PASSWORD || 'demo2024demo'
    const displayName = process.env.SEED_NAME || 'Demo User'

    // 1. Demo user + personal org
    let user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          password: await bcrypt.hash(password, 12),
          name: displayName,
        },
      })
      console.log(`✅ Created demo user: ${email} / ${password}`)
    } else {
      console.log(`ℹ User exists: ${email}`)
    }

    let membership = await prisma.orgMembership.findFirst({
      where: { userId: user.id },
      include: { org: true },
    })
    if (!membership) {
      const org = await prisma.organization.create({
        data: {
          name: `${displayName}'s workspace`,
          slug: `ws-${user.id.slice(0, 8)}-demo`,
          createdBy: user.id,
          members: { create: { userId: user.id, role: 'owner' } },
        },
      })
      membership = await prisma.orgMembership.findFirst({
        where: { orgId: org.id, userId: user.id },
        include: { org: true },
      })
      console.log(`✅ Created personal org: ${org.name}`)
    }
    const org = membership!.org

    // 2. Three demo campaigns, one per platform
    const platforms = ['google', 'meta', 'tiktok'] as const
    for (const platform of platforms) {
      const name = `Demo ${platform.charAt(0).toUpperCase() + platform.slice(1)} Campaign`
      let campaign = await prisma.campaign.findFirst({
        where: { orgId: org.id, platform, name },
      })
      if (!campaign) {
        campaign = await prisma.campaign.create({
          data: {
            orgId: org.id,
            userId: user.id,
            name,
            platform,
            status: 'active',
            objective: 'conversion',
            targetCountries: JSON.stringify(['US', 'CA', 'GB']),
            ageMin: 18,
            ageMax: 44,
            gender: 'all',
          },
        })
        console.log(`  + campaign ${name}`)

        await prisma.budget.create({
          data: {
            orgId: org.id,
            userId: user.id,
            campaignId: campaign.id,
            type: 'daily',
            amount: 100,
            currency: 'USD',
            spent: 47 + Math.random() * 50,
          },
        })
      }

      // 3. 7 days of sample reports per platform
      const p = PLATFORM_COLORS[platform]
      for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
        const date = new Date()
        date.setHours(0, 0, 0, 0)
        date.setDate(date.getDate() - daysAgo)
        const jitter = 0.85 + Math.random() * 0.3
        const impressions = Math.round(p.impressions * jitter / 7)
        const clicks = Math.round(p.clicks * jitter / 7)
        const conversions = Math.round(p.conversions * jitter / 7)
        const spend = Math.round(conversions * p.cpa * 100) / 100
        const revenue = Math.round(p.revenue * jitter / 7 * 100) / 100

        const reportId = `${platform}-${org.id}-${date.toISOString().slice(0, 10)}`
        await prisma.report.upsert({
          where: { id: reportId },
          update: {},
          create: {
            id: reportId,
            orgId: org.id,
            userId: user.id,
            campaignId: campaign.id,
            platform,
            date,
            impressions,
            clicks,
            conversions,
            spend,
            revenue,
            installs: Math.round(conversions * 0.4),
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            cpc: clicks > 0 ? spend / clicks : 0,
            cpa: conversions > 0 ? spend / conversions : 0,
            roas: spend > 0 ? revenue / spend : 0,
            rawData: JSON.stringify({ seeded: true }),
          },
        })
      }
    }

    console.log(`\n✅ Seed complete.`)
    console.log(`   Login:     ${email}`)
    console.log(`   Password:  ${password}`)
    console.log(`   Workspace: ${org.name}`)
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
