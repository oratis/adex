'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { api } from '@/lib/utils'

type Step = {
  num: number
  title: { en: string; zh: string }
  description: { en: string; zh: string }
  done: boolean
  cta: { label: string; href?: string; onClick?: () => Promise<void> | void }
}

export function SetupWizard({
  orgName,
  authsCount,
  campaignsCount,
  agentEnabled,
}: {
  orgName: string
  authsCount: number
  campaignsCount: number
  agentEnabled: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [seeding, setSeeding] = useState(false)

  async function loadDemoData() {
    if (
      !(await confirm({
        title: 'Load demo data?',
        message:
          'Load 3 demo campaigns + 7 days of fake metrics?\n\n这是一个安全的演示数据集，不会接触任何真实平台。可以随时手动删除（在 /campaigns）。',
        confirmLabel: 'Load demo',
      }))
    )
      return
    setSeeding(true)
    try {
      const res = await fetch(api('/api/setup/demo-data'), { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to load demo data')
      } else {
        router.push('/dashboard')
      }
    } finally {
      setSeeding(false)
    }
  }

  const steps: Step[] = [
    {
      num: 1,
      title: { en: 'Connect a platform', zh: '接入广告平台' },
      description: {
        en: 'Hook up Google / Meta / TikTok via OAuth so Adex can pull your data and (later) make changes.',
        zh: '通过 OAuth 接 Google / Meta / TikTok，Adex 可以拉取数据，以及（后续）替你操作。',
      },
      done: authsCount > 0,
      cta: { label: 'Open Settings', href: '/settings?tab=platforms' },
    },
    {
      num: 2,
      title: { en: 'Create your first campaign', zh: '创建第一条 Campaign' },
      description: {
        en: 'Or — load demo data to see what the dashboard looks like with content. Skip if you already have campaigns on a connected platform.',
        zh: '或者加载演示数据先看看长什么样。已经在平台有 campaign 的可以跳过这步。',
      },
      done: campaignsCount > 0,
      cta: { label: 'New Campaign', href: '/campaigns' },
    },
    {
      num: 3,
      title: { en: 'Try the AI advisor (low-risk)', zh: '试试 AI 顾问（无风险）' },
      description: {
        en: 'Click "Get advice" — Claude reads your last 7 days and suggests pause/resume actions you can apply with one click.',
        zh: '进 /advisor 点 "Get advice"——Claude 看完你最近 7 天数据，给暂停/恢复建议，一键执行。',
      },
      done: false,
      cta: { label: 'Open Advisor', href: '/advisor' },
    },
    {
      num: 4,
      title: { en: 'Enable Agent in shadow mode (when ready)', zh: '准备好后开启 Agent 观察模式' },
      description: {
        en: 'Shadow = AI thinks, but does NOT touch the platform. Spend a week here before promoting to approval mode.',
        zh: 'Shadow 模式：AI 推理但不操作平台。建议先观察一周再升级到审批模式。',
      },
      done: agentEnabled,
      cta: { label: 'Open Onboarding', href: '/agent-onboarding' },
    },
  ]

  const completedSteps = steps.filter((s) => s.done).length

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">欢迎来到 Adex · Welcome</h1>
        <p className="text-gray-600 mt-2">
          {orgName} · 4 步上手指南 / 4-step setup
        </p>
        <div className="flex justify-center gap-1 mt-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={
                'w-12 h-1.5 rounded ' +
                (steps[i - 1].done ? 'bg-emerald-500' : 'bg-gray-200')
              }
            />
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {completedSteps} / 4 完成 · click any step to start
        </p>
      </div>

      <div className="space-y-3">
        {steps.map((s) => (
          <Card key={s.num}>
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div
                  className={
                    'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ' +
                    (s.done
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-blue-100 text-blue-700')
                  }
                >
                  {s.done ? '✓' : s.num}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{s.title.zh}</h3>
                    <span className="text-sm text-gray-500">· {s.title.en}</span>
                    {s.done && <Badge className="bg-emerald-100 text-emerald-700">done</Badge>}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    {s.description.zh}
                    <br />
                    <span className="text-xs text-gray-400">{s.description.en}</span>
                  </p>
                </div>
                <div>
                  {s.cta.href ? (
                    <Link href={s.cta.href}>
                      <Button variant={s.done ? 'outline' : 'primary'}>{s.cta.label}</Button>
                    </Link>
                  ) : (
                    <Button variant={s.done ? 'outline' : 'primary'} onClick={s.cta.onClick}>
                      {s.cta.label}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {campaignsCount === 0 && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold">不想接真实账号？先试试演示数据</h3>
              <p className="text-sm text-gray-600">
                Don&apos;t want to connect a real account yet? Load demo data to explore the platform.
                <br />3 个示例 campaign + 7 天虚假指标，足够你点完所有按钮看看效果。
              </p>
            </div>
            <Button onClick={loadDemoData} disabled={seeding}>
              {seeding ? 'Loading…' : 'Load demo data'}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="text-center pt-4">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:underline">
          Skip setup and go to dashboard →
        </Link>
      </div>
    </div>
  )
}
