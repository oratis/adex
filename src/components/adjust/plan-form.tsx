'use client'
import { Button } from '@/components/ui/button'
import { Plus, Trash2 } from 'lucide-react'
import {
  ADJUST_PLATFORMS,
  METRIC_SLOTS,
  type AdjustPlan,
  type MetricSlot,
  type Traffic,
} from '@/lib/reports/adjust-data'
import type { AdjustEvent } from '@/lib/platforms/adjust'
import { Field, inputClass, metricNames, trafficNames } from './fields'

export function AdjustPlanForm({
  plan,
  setPlan,
  events,
  products,
  canManage,
  busy,
}: {
  plan: AdjustPlan
  setPlan: (plan: AdjustPlan) => void
  events: AdjustEvent[]
  products: Array<{ id: string; name: string; platform: string }>
  canManage: boolean
  busy: boolean
}) {
  function setMetric(slot: MetricSlot, id: string) {
    const metrics = { ...plan.metrics }
    const event = events.find((event) => event.id === id)
    if (!event) delete metrics[slot]
    else
      metrics[slot] = {
        id,
        name: event.name,
        kind:
          slot === 'revenue' ? 'money' : slot === 'payer' ? 'users' : 'events',
      }
    setPlan({ ...plan, metrics, metricsConfirmed: false })
  }

  return (
    <fieldset disabled={busy || !canManage} className="space-y-5 border-b pb-5">
      <legend className="mb-3 text-lg font-semibold">应用配置</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field htmlFor="adjust-product" label="关联 Adex 产品">
          <select
            id="adjust-product"
            className={inputClass}
            value={plan.productId || ''}
            onChange={(event) =>
              setPlan({
                ...plan,
                productId: event.target.value || null,
              })
            }
          >
            <option value="">独立 Adjust 应用</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} / {product.platform}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="adjust-currency" label="报表币种">
          <select
            id="adjust-currency"
            className={inputClass}
            value={plan.currency}
            onChange={(event) =>
              setPlan({ ...plan, currency: event.target.value })
            }
          >
            {['USD', 'CNY', 'EUR', 'GBP', 'JPY', 'KRW'].map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </Field>
        <Field htmlFor="adjust-utc-offset" label="UTC 偏移">
          <input
            id="adjust-utc-offset"
            className={inputClass}
            value={plan.utcOffset}
            onChange={(event) =>
              setPlan({ ...plan, utcOffset: event.target.value })
            }
            placeholder="+00:00"
          />
        </Field>
        <Field htmlFor="adjust-attribution-source" label="归因来源">
          <select
            id="adjust-attribution-source"
            className={inputClass}
            value={plan.attributionSource}
            onChange={(event) =>
              setPlan({
                ...plan,
                attributionSource: event.target
                  .value as AdjustPlan['attributionSource'],
              })
            }
          >
            <option value="first">首次安装来源</option>
            <option value="dynamic">动态归因来源</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {METRIC_SLOTS.map((slot) => (
          <div key={slot} className="space-y-2">
            <Field
              htmlFor={`adjust-metric-${slot}`}
              label={`${metricNames[slot]}指标`}
            >
              <select
                id={`adjust-metric-${slot}`}
                className={inputClass}
                value={plan.metrics[slot]?.id || ''}
                onChange={(event) => setMetric(slot, event.target.value)}
              >
                <option value="">未配置</option>
                {plan.metrics[slot] &&
                  !events.some(
                    (event) => event.id === plan.metrics[slot]?.id,
                  ) && (
                    <option value={plan.metrics[slot]!.id} disabled>
                      {plan.metrics[slot]!.name} / {plan.metrics[slot]!.id}{' '}
                      (已保存)
                    </option>
                  )}
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name} / {event.id}
                  </option>
                ))}
              </select>
            </Field>
            {slot === 'registration' && plan.metrics.registration && (
              <Field htmlFor="adjust-registration-kind" label="注册计数口径">
                <select
                  id="adjust-registration-kind"
                  className={inputClass}
                  value={plan.metrics.registration.kind}
                  onChange={(event) =>
                    setPlan({
                      ...plan,
                      metricsConfirmed: false,
                      metrics: {
                        ...plan.metrics,
                        registration: {
                          ...plan.metrics.registration!,
                          kind: event.target.value as 'events' | 'users',
                        },
                      },
                    })
                  }
                >
                  <option value="events">事件次数</option>
                  <option value="users">区间去重人数</option>
                </select>
              </Field>
            )}
            {plan.metrics[slot] && (
              <p className="break-words text-xs text-gray-500">
                {events.find((event) => event.id === plan.metrics[slot]?.id)
                  ?.description || plan.metrics[slot]?.id}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        付费人数口径为区间去重用户，不是购买次数。当前报表为区间指标，不标注注册
        cohort 或 D7 ROAS。
      </p>
      {Object.keys(plan.metrics).length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={plan.metricsConfirmed}
            onChange={(event) =>
              setPlan({ ...plan, metricsConfirmed: event.target.checked })
            }
          />
          已按 Adjust 指标定义核对事件次数、区间去重人数及收入口径
        </label>
      )}
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={plan.reattributed === 'all'}
            onChange={(event) =>
              setPlan({
                ...plan,
                reattributed: event.target.checked ? 'all' : 'false',
              })
            }
          />
          包含再归因用户
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={plan.autoSync}
            onChange={(event) =>
              setPlan({ ...plan, autoSync: event.target.checked })
            }
          />
          每日同步最近 7 个完整报表日期（依赖现有每日调度）
        </label>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">来源映射</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setPlan({
                ...plan,
                sourceRules: [
                  ...plan.sourceRules,
                  {
                    network: '',
                    partner: '',
                    traffic: 'unknown',
                    platform: null,
                  },
                ],
              })
            }
          >
            <Plus size={16} className="mr-1" />
            添加
          </Button>
        </div>
        {plan.sourceRules.map((rule, index) => (
          <div
            key={index}
            className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_36px]"
          >
            <Field
              htmlFor={`adjust-rule-${index}-network`}
              label="原始 Network"
            >
              <input
                id={`adjust-rule-${index}-network`}
                className={inputClass}
                value={rule.network}
                onChange={(event) =>
                  setPlan({
                    ...plan,
                    sourceRules: plan.sourceRules.map((rule, i) =>
                      i === index
                        ? { ...rule, network: event.target.value }
                        : rule,
                    ),
                  })
                }
              />
            </Field>
            <Field
              htmlFor={`adjust-rule-${index}-partner`}
              label="原始 Partner"
            >
              <input
                id={`adjust-rule-${index}-partner`}
                className={inputClass}
                value={rule.partner}
                onChange={(event) =>
                  setPlan({
                    ...plan,
                    sourceRules: plan.sourceRules.map((rule, i) =>
                      i === index
                        ? { ...rule, partner: event.target.value }
                        : rule,
                    ),
                  })
                }
              />
            </Field>
            <Field htmlFor={`adjust-rule-${index}-traffic`} label="流量类型">
              <select
                id={`adjust-rule-${index}-traffic`}
                className={inputClass}
                value={rule.traffic}
                onChange={(event) =>
                  setPlan({
                    ...plan,
                    sourceRules: plan.sourceRules.map((rule, i) =>
                      i === index
                        ? {
                            ...rule,
                            traffic: event.target.value as Traffic,
                            platform:
                              event.target.value === 'organic'
                                ? null
                                : rule.platform,
                          }
                        : rule,
                    ),
                  })
                }
              >
                {Object.entries(trafficNames).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor={`adjust-rule-${index}-platform`} label="平台">
              <select
                id={`adjust-rule-${index}-platform`}
                className={inputClass}
                value={rule.platform || ''}
                onChange={(event) =>
                  setPlan({
                    ...plan,
                    sourceRules: plan.sourceRules.map((rule, i) =>
                      i === index
                        ? {
                            ...rule,
                            platform: event.target.value || null,
                          }
                        : rule,
                    ),
                  })
                }
              >
                <option value="">未指定</option>
                {ADJUST_PLATFORMS.map((platform) => (
                  <option key={platform}>{platform}</option>
                ))}
              </select>
            </Field>
            <button
              className="h-9 w-9"
              aria-label={`删除来源映射 ${index + 1}`}
              title="删除来源映射"
              onClick={() =>
                setPlan({
                  ...plan,
                  sourceRules: plan.sourceRules.filter((_, i) => i !== index),
                })
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </fieldset>
  )
}
