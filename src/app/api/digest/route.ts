import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

export async function POST() {
  try {
    const user = await requireAuth()

    // Get recent reports
    const endDate = new Date()
    const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const reports = await prisma.report.findMany({
      where: {
        userId: user.id,
        date: { gte: startDate, lte: endDate },
      },
    })

    const campaigns = await prisma.campaign.findMany({
      where: { userId: user.id, status: 'active' },
    })

    const totalSpend = reports.reduce((s, r) => s + r.spend, 0)
    const totalRevenue = reports.reduce((s, r) => s + r.revenue, 0)
    const totalImpressions = reports.reduce((s, r) => s + r.impressions, 0)
    const totalClicks = reports.reduce((s, r) => s + r.clicks, 0)
    const totalConversions = reports.reduce((s, r) => s + r.conversions, 0)

    const digestContent = `
      <h2>Daily Ad Performance Report</h2>
      <p>Date: ${endDate.toLocaleDateString()}</p>
      <hr/>
      <h3>Summary</h3>
      <ul>
        <li><strong>Active Campaigns:</strong> ${campaigns.length}</li>
        <li><strong>Total Spend:</strong> $${totalSpend.toFixed(2)}</li>
        <li><strong>Revenue:</strong> $${totalRevenue.toFixed(2)}</li>
        <li><strong>ROAS:</strong> ${totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : 'N/A'}x</li>
        <li><strong>Impressions:</strong> ${totalImpressions.toLocaleString()}</li>
        <li><strong>Clicks:</strong> ${totalClicks.toLocaleString()}</li>
        <li><strong>Conversions:</strong> ${totalConversions.toLocaleString()}</li>
      </ul>
      <h3>Recommendations</h3>
      <ul>
        ${totalSpend > 0 && totalRevenue / totalSpend < 1 ? '<li>ROAS is below 1x. Consider pausing underperforming campaigns.</li>' : ''}
        ${totalImpressions > 0 && (totalClicks / totalImpressions) < 0.01 ? '<li>CTR is low. Test new creative variants.</li>' : ''}
        ${campaigns.length === 0 ? '<li>No active campaigns. Launch campaigns to start generating results.</li>' : ''}
      </ul>
    `

    // Save digest
    const digest = await prisma.dailyDigest.create({
      data: {
        userId: user.id,
        date: endDate,
        content: digestContent,
        advice: 'Review recommendations above and adjust campaigns accordingly.',
      },
    })

    // If user has email configured, would send email here
    // For now, just return the digest
    if (user.dailyReportEmail) {
      // In production: use nodemailer to send email
      // await sendEmail(user.dailyReportEmail, 'Adex Daily Report', digestContent)
    }

    return NextResponse.json({ digest, emailSent: !!user.dailyReportEmail })
  } catch {
    return NextResponse.json({ error: 'Failed to generate digest' }, { status: 500 })
  }
}
