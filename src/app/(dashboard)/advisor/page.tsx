'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatNumber, api } from '@/lib/utils'

interface Report {
  id: string
  platform: string
  date: string
  impressions: number
  clicks: number
  conversions: number
  spend: number
  revenue: number
  ctr: number
  cpc: number
  cpa: number
  roas: number
}

interface Campaign {
  id: string
  name: string
  platform: string
  status: string
  targetCountries: string | null
}

interface Advice {
  type: 'optimization' | 'warning' | 'opportunity'
  title: string
  description: string
  platform?: string
}

export default function AdvisorPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [advice, setAdvice] = useState<Advice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(api('/api/reports')).then(r => r.json()),
      fetch(api('/api/campaigns')).then(r => r.json()),
    ]).then(([reportData, campaignData]) => {
      const r = Array.isArray(reportData) ? reportData : []
      const c = Array.isArray(campaignData) ? campaignData : []
      setReports(r)
      setCampaigns(c)
      setAdvice(generateAdvice(r, c))
      setLoading(false)
    })
  }, [])

  function generateAdvice(reports: Report[], campaigns: Campaign[]): Advice[] {
    const tips: Advice[] = []

    // Analyze by platform
    const platforms = ['google', 'meta', 'tiktok']
    for (const platform of platforms) {
      const platformReports = reports.filter(r => r.platform === platform)
      if (platformReports.length === 0) continue

      const totalSpend = platformReports.reduce((s, r) => s + r.spend, 0)
      const totalRevenue = platformReports.reduce((s, r) => s + r.revenue, 0)
      const avgCTR = platformReports.reduce((s, r) => s + r.ctr, 0) / platformReports.length
      const avgCPA = platformReports.reduce((s, r) => s + r.cpa, 0) / platformReports.length
      const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0

      if (roas < 1 && totalSpend > 0) {
        tips.push({
          type: 'warning',
          title: `Low ROAS on ${platform}`,
          description: `Your ${platform} campaigns have a ROAS of ${roas.toFixed(2)}x. Consider pausing underperforming ad groups and reallocating budget to higher-performing ones.`,
          platform,
        })
      }

      if (avgCTR < 0.01) {
        tips.push({
          type: 'optimization',
          title: `Low CTR on ${platform}`,
          description: `Average CTR is ${(avgCTR * 100).toFixed(2)}%. Try testing new ad creatives with stronger calls-to-action, or refine your audience targeting.`,
          platform,
        })
      }

      if (avgCPA > 50) {
        tips.push({
          type: 'optimization',
          title: `High CPA on ${platform}`,
          description: `Average CPA is ${formatCurrency(avgCPA)}. Consider narrowing your audience to more qualified users, or testing lower-funnel conversion objectives.`,
          platform,
        })
      }

      if (roas > 3) {
        tips.push({
          type: 'opportunity',
          title: `Scale ${platform} campaigns`,
          description: `ROAS of ${roas.toFixed(2)}x is excellent! Consider increasing budgets by 20-30% to capture more conversions while maintaining efficiency.`,
          platform,
        })
      }
    }

    // Check for campaigns without activity
    const activeCampaigns = campaigns.filter(c => c.status === 'active')
    const draftCampaigns = campaigns.filter(c => c.status === 'draft')

    if (draftCampaigns.length > 0) {
      tips.push({
        type: 'opportunity',
        title: `${draftCampaigns.length} draft campaign(s) ready to launch`,
        description: `You have ${draftCampaigns.length} campaigns in draft status. Review and launch them to start driving results.`,
      })
    }

    if (activeCampaigns.length === 0 && campaigns.length > 0) {
      tips.push({
        type: 'warning',
        title: 'No active campaigns',
        description: 'All your campaigns are paused or in draft. Activate at least one campaign to start receiving traffic.',
      })
    }

    // Cross-platform suggestions
    const platformsWithData = platforms.filter(p => reports.some(r => r.platform === p))
    const missingPlatforms = platforms.filter(p => !platformsWithData.includes(p))
    if (missingPlatforms.length > 0 && platformsWithData.length > 0) {
      tips.push({
        type: 'opportunity',
        title: 'Expand to new platforms',
        description: `You're not running ads on ${missingPlatforms.map(p => p === 'meta' ? 'Meta' : p === 'tiktok' ? 'TikTok' : 'Google').join(', ')}. Diversifying platforms can help reach new audiences and reduce CPA.`,
      })
    }

    if (tips.length === 0) {
      tips.push({
        type: 'optimization',
        title: 'Get started',
        description: 'Connect your ad platforms in Settings and create your first campaign to start receiving AI-powered optimization advice.',
      })
    }

    return tips
  }

  const adviceIcon = (type: string) => {
    switch (type) {
      case 'warning': return '⚠️'
      case 'opportunity': return '🚀'
      default: return '💡'
    }
  }

  const adviceVariant = (type: string) => {
    switch (type) {
      case 'warning': return 'warning' as const
      case 'opportunity': return 'success' as const
      default: return 'info' as const
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading advisor...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI Advisor</h1>
        <p className="text-gray-500 text-sm mt-1">AI-powered optimization suggestions based on your campaign performance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 text-center">
          <p className="text-3xl font-bold">{campaigns.length}</p>
          <p className="text-sm text-gray-500 mt-1">Total Campaigns</p>
        </Card>
        <Card className="p-5 text-center">
          <p className="text-3xl font-bold">{formatCurrency(reports.reduce((s, r) => s + r.spend, 0))}</p>
          <p className="text-sm text-gray-500 mt-1">Total Spend</p>
        </Card>
        <Card className="p-5 text-center">
          <p className="text-3xl font-bold">{formatNumber(reports.reduce((s, r) => s + r.conversions, 0))}</p>
          <p className="text-sm text-gray-500 mt-1">Total Conversions</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Optimization Advice ({advice.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {advice.map((a, i) => (
              <div key={i} className="border rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">{adviceIcon(a.type)}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm">{a.title}</h3>
                      <Badge variant={adviceVariant(a.type)}>{a.type}</Badge>
                      {a.platform && <Badge>{a.platform}</Badge>}
                    </div>
                    <p className="text-sm text-gray-600">{a.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
