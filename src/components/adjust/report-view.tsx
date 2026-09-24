'use client'
import { useState } from 'react'
import { Download } from 'lucide-react'
import {
  METRIC_SLOTS,
  type AdjustPlan,
  type AdjustNormalizedReport,
} from '@/lib/reports/adjust-data'
import { Field, inputClass, metricNames, trafficNames } from './fields'
export type Report = {
  plan: AdjustPlan
  startDate: string
  endDate: string
  data: AdjustNormalizedReport & { providerWarningCount: number }
  syncedAt?: string
  stale?: boolean
}

const valueText = (value: number | null) =>
  value === null
    ? '--'
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 })

export function AdjustReportView({
  report,
  draftChanged,
}: {
  report: Report
  draftChanged: boolean
}) {
  const [traffic, setTraffic] = useState('all')
  const [platform, setPlatform] = useState('all')
  function exportCsv() {
    if (!report) return
    const fields = [
      'network',
      'partner',
      'traffic',
      'platform',
      'os',
      'accountId',
      'campaignId',
      'campaignName',
      'installs',
      'registration',
      'payer',
      'revenue',
      'reason',
    ] as const
    const quote = (value: unknown) =>
      `"${(typeof value === 'string' ? value.replace(/^[=+\-@\t\r\n]/, "'$&") : String(value ?? '')).replaceAll('"', '""')}"`
    const metadata = {
      appToken: report.plan.appToken,
      startDate: report.startDate,
      endDate: report.endDate,
      currency: report.plan.currency,
      utcOffset: report.plan.utcOffset,
      attributionSource: report.plan.attributionSource,
      registrationMetric: report.plan.metrics.registration?.id ?? '',
      registrationKind: report.plan.metrics.registration?.kind ?? '',
      payerMetric: report.plan.metrics.payer?.id ?? '',
      revenueMetric: report.plan.metrics.revenue?.id ?? '',
    }
    const csv = [
      [...Object.keys(metadata), ...fields].join(','),
      ...visibleRows.map((row) =>
        [...Object.values(metadata), ...fields.map((field) => row[field])]
          .map(quote)
          .join(','),
      ),
    ].join('\n')
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `adjust-${report.plan.appToken}-${report.startDate}-${report.endDate}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const visibleRows =
    report?.data.rows.filter(
      (row) =>
        (traffic === 'all' || row.traffic === traffic) &&
        (platform === 'all' || (row.platform ?? 'unknown') === platform),
    ) ?? []

  return (
    <section className="space-y-4 border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {report.plan.appName} / 报表
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {report.startDate} ~ {report.endDate} · {report.plan.currency} · UTC
            {report.plan.utcOffset} ·{' '}
            {report.syncedAt
              ? `更新于 ${new Date(report.syncedAt).toLocaleString()}`
              : '未保存的预览'}
          </p>
        </div>
        <button
          title="导出当前筛选 CSV"
          aria-label="导出 CSV"
          className="h-9 w-9"
          onClick={exportCsv}
        >
          <Download size={18} />
        </button>
      </div>
      {(draftChanged || report.stale) && (
        <p role="status" className="text-sm text-amber-700">
          配置已变化，当前显示的是上次查询口径
        </p>
      )}
      {report.data.providerWarningCount > 0 && (
        <p role="alert" className="text-sm text-amber-700">
          Adjust 返回 {report.data.providerWarningCount}{' '}
          项数据警告，报表可能不完整
        </p>
      )}
      <p className="text-xs text-gray-500">
        全应用 / 当前区间。总量由 Adjust
        独立查询，不累加明细去重人数；不含媒体花费。
      </p>
      <dl className="grid grid-cols-2 gap-5 border-y py-4 sm:grid-cols-4">
        {(['installs', ...METRIC_SLOTS] as const).map((slot) => (
          <div key={slot}>
            <dt className="text-xs text-gray-500">
              {slot === 'installs'
                ? '安装'
                : `${metricNames[slot]}${slot === 'registration' ? (report.plan.metrics.registration?.kind === 'users' ? '人数' : '次数') : ''}`}
            </dt>
            <dd className="mt-1 text-xl font-semibold">
              {valueText(report.data.totals[slot])}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="adjust-filter-traffic" label="流量筛选">
          <select
            id="adjust-filter-traffic"
            className={inputClass}
            value={traffic}
            onChange={(event) => setTraffic(event.target.value)}
          >
            <option value="all">全部流量</option>
            {Object.entries(trafficNames).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="adjust-filter-platform" label="平台筛选">
          <select
            id="adjust-filter-platform"
            className={inputClass}
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
          >
            <option value="all">全部平台</option>
            {[
              ...new Set(
                report.data.rows.map((row) => row.platform ?? 'unknown'),
              ),
            ].map((platform) => (
              <option key={platform} value={platform}>
                {platform === 'unknown' ? '未归属平台' : platform}
              </option>
            ))}
          </select>
        </Field>
        <span className="py-2 text-sm text-gray-500">
          {visibleRows.length} 条明细
        </span>
      </div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left text-sm [&_th]:px-3 [&_th]:py-3 [&_td]:px-3 [&_td]:py-3">
          <thead className="border-b text-gray-500">
            <tr>
              <th>流量</th>
              <th>平台</th>
              <th>原始来源 / Partner</th>
              <th>OS</th>
              <th>账户 / 系列 ID</th>
              <th>安装</th>
              <th>
                注册
                {report.plan.metrics.registration?.kind === 'users'
                  ? '人数'
                  : '次数'}
              </th>
              <th>付费人数</th>
              <th>收入</th>
              <th>分类依据</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr key={i} className="border-b">
                <td>{trafficNames[row.traffic]}</td>
                <td>{row.platform || '--'}</td>
                <td className="max-w-64 break-words">
                  {row.network || '--'}
                  <div className="text-xs text-gray-500">
                    {row.partner || '--'}
                  </div>
                </td>
                <td>{row.os || '--'}</td>
                <td className="max-w-64 break-words">
                  {row.campaignName || '--'}
                  <div className="text-xs text-gray-500">
                    {row.accountId || '--'} / {row.campaignId || '--'}
                  </div>
                </td>
                <td>{valueText(row.installs)}</td>
                <td>{valueText(row.registration)}</td>
                <td>{valueText(row.payer)}</td>
                <td>{valueText(row.revenue)}</td>
                <td>{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visibleRows.length && (
        <p className="py-6 text-center text-sm text-gray-500">
          当前筛选下没有数据
        </p>
      )}
    </section>
  )
}
