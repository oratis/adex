import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthWithOrg } from '@/lib/auth'

// GET /api/reports/export?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&platform=google
// Returns a CSV download of the org's performance reports.
export async function GET(req: NextRequest) {
  let org
  try {
    const ctx = await requireAuthWithOrg()
    org = ctx.org
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const params = req.nextUrl.searchParams
    const platform = params.get('platform')
    const startDate = params.get('startDate')
    const endDate = params.get('endDate')
    const campaignId = params.get('campaignId')

    const where: Record<string, unknown> = { orgId: org.id }
    if (platform) where.platform = platform
    if (campaignId) where.campaignId = campaignId
    if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) }
    }

    const reports = await prisma.report.findMany({
      where,
      include: { campaign: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 10_000, // cap export size
    })

    // Build CSV with proper escaping
    const headers = [
      'date',
      'platform',
      'campaign',
      'impressions',
      'clicks',
      'conversions',
      'installs',
      'spend',
      'revenue',
      'ctr',
      'cpc',
      'cpa',
      'roas',
    ]
    const lines = [headers.join(',')]

    for (const r of reports) {
      const row = [
        r.date.toISOString().slice(0, 10),
        r.platform,
        csvField(r.campaign?.name || ''),
        r.impressions,
        r.clicks,
        r.conversions,
        r.installs,
        r.spend.toFixed(2),
        r.revenue.toFixed(2),
        r.ctr.toFixed(4),
        r.cpc.toFixed(4),
        r.cpa.toFixed(4),
        r.roas.toFixed(4),
      ]
      lines.push(row.join(','))
    }

    const filename = `adex-reports-${org.slug}-${new Date().toISOString().slice(0, 10)}.csv`
    return new Response(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed'
    return new Response(message, { status: 500 })
  }
}

function csvField(value: string): string {
  // Quote if the field contains a comma, quote, or newline; escape inner quotes
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
