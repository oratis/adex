import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'

export interface DataTableColumn<T> {
  key: string
  label: string
  align?: 'left' | 'right'
  /** Cell renderer; receives the row. Defaults to String(row[key]). */
  format?: (row: T) => React.ReactNode
  /** Tooltip on the header cell (e.g. "待归因打通" for funnel-join-pending columns). */
  title?: string
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  getRowKey: (row: T, index: number) => string
  /** Rendered as a bolded final row, e.g. a grand-total. Same column shape as `rows`. */
  totals?: T
  totalsLabel?: string
  emptyEmoji?: string
  emptyTitle?: string
  emptyDescription?: string
  className?: string
}

/**
 * Generic, business-agnostic table: column defs + row data + optional bolded
 * totals row. Follows the growth pages' hand-rolled table styling
 * (overflow-x-auto wrapper, text-sm, border-b rows) so it drops into any BI
 * page without a new visual language.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  totals,
  totalsLabel = '合计',
  emptyEmoji = '📊',
  emptyTitle = '暂无数据',
  emptyDescription,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <EmptyState emoji={emptyEmoji} title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            {columns.map((c) => (
              <th
                key={c.key}
                title={c.title}
                className={cn('pb-3 font-medium whitespace-nowrap', c.align === 'right' && 'text-right')}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={getRowKey(row, i)} className="border-b last:border-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('py-3 font-mono tabular-nums whitespace-nowrap', c.align === 'right' && 'text-right')}
                >
                  {c.format ? c.format(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="font-semibold border-t-2">
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={cn('py-3 font-mono tabular-nums whitespace-nowrap', c.align === 'right' && 'text-right')}
                >
                  {i === 0 ? totalsLabel : c.format ? c.format(totals) : String((totals as Record<string, unknown>)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
