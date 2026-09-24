'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Eye, Link2, RefreshCw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/utils'
import type { AdjustPlan } from '@/lib/reports/adjust-data'
import type { AdjustCatalogItem, AdjustEvent } from '@/lib/platforms/adjust'
import { AdjustPlanForm } from './adjust/plan-form'
import { AdjustReportView, type Report } from './adjust/report-view'
import { Field, inputClass } from './adjust/fields'

type SetupState = {
  connected: boolean
  canManage: boolean
  plans: AdjustPlan[]
  products: Array<{ id: string; name: string; platform: string }>
}
const dateBefore = (days: number) =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
async function request<T>(
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(api(url), {
    method,
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Request failed')
  if (
    url.startsWith('/api/adjust/reports') &&
    data !== null &&
    (!data?.plan || !Array.isArray(data?.data?.rows) || !data?.data?.totals)
  )
    throw new Error('Invalid report response')
  return data
}

export function AdjustSetup() {
  const [state, setState] = useState<SetupState | null>(null)
  const [apps, setApps] = useState<AdjustCatalogItem[]>([])
  const [events, setEvents] = useState<AdjustEvent[]>([])
  const [token, setToken] = useState('')
  const [plan, setPlan] = useState<AdjustPlan | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [startDate, setStart] = useState(() => dateBefore(7))
  const [endDate, setEnd] = useState(() => dateBefore(1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    request<SetupState>('/api/adjust')
      .then((next) => {
        if (!Array.isArray(next.plans) || !Array.isArray(next.products))
          throw new Error('Invalid setup response')
        if (active) {
          setState(next)
          setApps(
            next.plans.map((plan) => ({
              id: plan.appToken,
              name: plan.appName,
            })),
          )
        }
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
    return () => {
      active = false
    }
  }, [])

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  async function discover() {
    const data = await request<{ apps: AdjustCatalogItem[] }>(
      '/api/adjust/catalog',
    )
    if (!Array.isArray(data.apps)) throw new Error('Invalid app catalog')
    setApps(data.apps)
    if (!data.apps.length) setNotice('此连接下没有可访问的应用')
  }

  async function selectApp(appToken: string) {
    setPlan(null)
    setReport(null)
    setEvents([])
    if (!appToken) return
    const app = apps.find((app) => app.id === appToken)!
    const saved = state?.plans.find((plan) => plan.appToken === appToken)
    const next: AdjustPlan = saved || {
      version: 1,
      appToken,
      appName: app.name,
      productId: null,
      currency: 'USD',
      utcOffset: '+00:00',
      attributionSource: 'first',
      reattributed: 'false',
      autoSync: false,
      metricsConfirmed: false,
      metrics: {},
      sourceRules: [],
    }
    // Saved data remains available even when the provider catalog is down.
    setPlan(next)
    if (saved)
      setReport(
        await request<Report | null>(
          `/api/adjust/reports?appToken=${encodeURIComponent(appToken)}`,
        ),
      )
    const catalog = state?.canManage
      ? await request<{ events: AdjustEvent[] }>(
          `/api/adjust/catalog?appToken=${encodeURIComponent(appToken)}`,
        )
      : { events: [] }
    if (!Array.isArray(catalog.events)) throw new Error('Invalid event catalog')
    setEvents(catalog.events)
  }

  const saved =
    !!plan && !!state?.plans.some((item) => item.appToken === plan.appToken)
  const draftChanged =
    !!report && JSON.stringify(plan) !== JSON.stringify(report.plan)
  const canSave =
    !!report &&
    !draftChanged &&
    report.startDate === startDate &&
    report.endDate === endDate

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          <Link href="/settings" aria-label="返回设置" title="返回设置">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-semibold">Adjust 数据连接</h1>
        </div>
        <span className="text-sm text-gray-500">
          {state
            ? state.connected
              ? '已连接'
              : '未连接'
            : error
              ? '加载失败'
              : '加载中'}
        </span>
      </header>
      {error && (
        <p
          role="alert"
          className="border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      {state?.canManage && (
        <section className="flex flex-wrap items-end gap-3 border-b pb-5">
          <div className="w-full max-w-md">
            <Field
              htmlFor="adjust-token"
              label={state.connected ? '替换 API Token' : 'API Token'}
            >
              <input
                id="adjust-token"
                className={inputClass}
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
          <Button
            disabled={busy || !token.trim()}
            onClick={() =>
              run(async () => {
                const credential = token
                setToken('')
                const result = await request<{
                  connected: boolean
                  apps: AdjustCatalogItem[]
                }>('/api/adjust', 'POST', { token: credential })
                if (!Array.isArray(result.apps))
                  throw new Error('Invalid app catalog')
                setState({ ...state, connected: true })
                setApps(result.apps)
                setReport(null)
                setPlan(null)
                setNotice('连接已验证，凭据已加密保存')
              })
            }
          >
            <Link2 size={16} className="mr-2" />
            {state.connected ? '更新连接' : '连接'}
          </Button>
          <a
            href="https://dev.adjust.com/en/api/rs-api/authentication/"
            target="_blank"
            rel="noreferrer"
            className="py-2 text-sm underline"
          >
            Adjust 授权文档
          </a>
        </section>
      )}
      {state?.connected && (
        <>
          <section className="flex flex-wrap items-end gap-3">
            <div className="w-full max-w-md">
              <Field htmlFor="adjust-app" label="Adjust 应用">
                <select
                  id="adjust-app"
                  className={inputClass}
                  value={plan?.appToken || ''}
                  disabled={busy}
                  onChange={(event) => run(() => selectApp(event.target.value))}
                >
                  <option value="">选择应用</option>
                  {apps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name} ({app.id})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {state.canManage && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run(discover)}
              >
                <RefreshCw size={16} className="mr-2" />
                发现应用
              </Button>
            )}
          </section>
          {plan && (
            <>
              <AdjustPlanForm
                plan={plan}
                setPlan={setPlan}
                events={events}
                products={state.products}
                canManage={state.canManage}
                busy={busy}
              />
              <section className="flex flex-wrap items-end gap-3">
                <Field htmlFor="adjust-start-date" label="开始日期">
                  <input
                    id="adjust-start-date"
                    className={inputClass}
                    type="date"
                    value={startDate}
                    disabled={busy}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </Field>
                <Field htmlFor="adjust-end-date" label="结束日期">
                  <input
                    id="adjust-end-date"
                    className={inputClass}
                    type="date"
                    value={endDate}
                    disabled={busy}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </Field>
                {state.canManage && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const preview = await request<Report>(
                            '/api/adjust/reports',
                            'POST',
                            { plan, startDate, endDate },
                          )
                          setPlan(preview.plan)
                          setReport(preview)
                        })
                      }
                    >
                      <Eye size={16} className="mr-2" />
                      预览
                    </Button>
                    <Button
                      disabled={busy || !canSave}
                      onClick={() =>
                        run(async () => {
                          await request('/api/adjust', 'PUT', { plan })
                          setState({
                            ...state,
                            plans: [
                              ...state.plans.filter(
                                (item) => item.appToken !== plan.appToken,
                              ),
                              plan,
                            ],
                          })
                          setReport(
                            await request<Report>(
                              '/api/adjust/reports',
                              'PUT',
                              { appToken: plan.appToken, startDate, endDate },
                            ),
                          )
                          setNotice('配置及报表已保存')
                        })
                      }
                    >
                      <Save size={16} className="mr-2" />
                      保存并同步
                    </Button>
                    {saved && (
                      <Button
                        variant="outline"
                        disabled={busy || draftChanged}
                        onClick={() =>
                          run(async () =>
                            setReport(
                              await request<Report>(
                                '/api/adjust/reports',
                                'PUT',
                                { appToken: plan.appToken, startDate, endDate },
                              ),
                            ),
                          )
                        }
                      >
                        <RefreshCw size={16} className="mr-2" />
                        同步已保存配置
                      </Button>
                    )}
                  </>
                )}
                {busy && (
                  <span role="status" className="py-2 text-sm text-gray-500">
                    处理中
                  </span>
                )}
              </section>
            </>
          )}
          {report && (
            <AdjustReportView
              key={report.plan.appToken}
              report={report}
              draftChanged={draftChanged}
            />
          )}
        </>
      )}
    </div>
  )
}
