import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { GoogleAdsClient } from '@/lib/platforms/google'

export async function POST() {
  let user
  try {
    user = await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, unknown> = {}
  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  try {
    const auths = await prisma.platformAuth.findMany({
      where: { userId: user.id, isActive: true },
    })

    if (auths.length === 0) {
      return NextResponse.json({
        synced: true,
        results: { info: 'No platforms connected. Go to Settings to connect.' },
        dateRange: { startDate, endDate },
      })
    }

    for (const auth of auths) {
      try {
        switch (auth.platform) {
          case 'google': {
            if (!auth.refreshToken || !auth.apiKey) {
              results.google = { error: 'Missing refresh token or developer token' }
              break
            }

            const client = new GoogleAdsClient({
              accessToken: auth.accessToken || '',
              refreshToken: auth.refreshToken,
              customerId: auth.accountId || '',
              developerToken: auth.apiKey,
            })

            // Refresh access token first
            let newToken: string
            try {
              newToken = await client.refreshAccessToken()
            } catch (err) {
              results.google = { error: `Token refresh failed: ${err instanceof Error ? err.message : 'unknown'}` }
              break
            }

            // Update stored token
            await prisma.platformAuth.update({
              where: { id: auth.id },
              data: { accessToken: newToken },
            })

            // Get all accessible customer accounts
            let customerIds: string[]
            try {
              customerIds = await client.listAccessibleCustomers()
            } catch (err) {
              results.google = { error: `Failed to list accounts: ${err instanceof Error ? err.message : 'unknown'}` }
              break
            }

            const nonManagerIds: string[] = []

            // Filter out manager accounts (we want actual ad accounts)
            for (const cid of customerIds) {
              try {
                const data = await client.search(cid,
                  'SELECT customer.id, customer.manager FROM customer LIMIT 1')
                const customer = (data.results?.[0] as Record<string, Record<string, unknown>>)?.customer
                if (!customer?.manager) {
                  nonManagerIds.push(cid)
                }
              } catch {
                // Skip accounts we can't access
              }
            }

            // Fetch reports for each non-manager account
            let totalImpressions = 0, totalClicks = 0, totalConversions = 0, totalSpend = 0, totalRevenue = 0

            for (const cid of nonManagerIds) {
              try {
                const report = await client.getAggregatedReport(cid, startDate, endDate)
                totalImpressions += report.impressions
                totalClicks += report.clicks
                totalConversions += report.conversions
                totalSpend += report.spend
                totalRevenue += report.revenue
              } catch (err) {
                console.error(`Failed to get report for ${cid}:`, err)
              }
            }

            // Save aggregated report to DB
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const reportId = `google-${user.id}-${endDate}`

            await prisma.report.upsert({
              where: { id: reportId },
              update: {
                impressions: totalImpressions,
                clicks: totalClicks,
                conversions: totalConversions,
                spend: totalSpend,
                revenue: totalRevenue,
                ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
                cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
                roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
                rawData: JSON.stringify({ customerIds: nonManagerIds, startDate, endDate }),
              },
              create: {
                id: reportId,
                userId: user.id,
                platform: 'google',
                date: today,
                impressions: totalImpressions,
                clicks: totalClicks,
                conversions: totalConversions,
                spend: totalSpend,
                revenue: totalRevenue,
                ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
                cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
                roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
                rawData: JSON.stringify({ customerIds: nonManagerIds, startDate, endDate }),
              },
            })

            results.google = {
              success: true,
              accounts: nonManagerIds.length,
              impressions: totalImpressions,
              clicks: totalClicks,
              conversions: totalConversions,
              spend: totalSpend,
              revenue: totalRevenue,
            }
            break
          }

          case 'meta': {
            results.meta = { error: 'Not yet implemented for live sync' }
            break
          }

          case 'tiktok': {
            results.tiktok = { error: 'Not yet implemented for live sync' }
            break
          }

          case 'appsflyer': {
            results.appsflyer = { error: 'Not yet implemented for live sync' }
            break
          }

          case 'adjust': {
            results.adjust = { error: 'Not yet implemented for live sync' }
            break
          }

          default: {
            results[auth.platform] = { error: 'Unknown platform' }
          }
        }
      } catch (err) {
        results[auth.platform] = { error: err instanceof Error ? err.message : 'Sync failed' }
      }
    }
  } catch (err) {
    return NextResponse.json({
      synced: false,
      error: err instanceof Error ? err.message : 'Sync failed',
      results,
      dateRange: { startDate, endDate },
    }, { status: 500 })
  }

  return NextResponse.json({ synced: true, results, dateRange: { startDate, endDate } })
}
