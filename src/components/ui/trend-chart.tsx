'use client'

/**
 * Small dependency-free SVG line chart for time-series metrics.
 * Draws one line per series, shares a single y-axis, shows tooltip on hover.
 */

type SeriesPoint = { x: string; y: number }

export type TrendSeries = {
  name: string
  color: string
  points: SeriesPoint[]
}

export function TrendChart({
  series,
  height = 220,
  formatY,
  title,
}: {
  series: TrendSeries[]
  height?: number
  formatY?: (n: number) => string
  title?: string
}) {
  // Collect every x (date label) in order
  const xLabels = Array.from(
    new Set(series.flatMap((s) => s.points.map((p) => p.x)))
  ).sort()

  if (xLabels.length === 0) {
    return (
      <div className="text-sm text-gray-400 text-center py-8">
        No data to chart yet. Sync performance data to see the trend.
      </div>
    )
  }

  const width = 600
  const padding = { top: 16, right: 16, bottom: 28, left: 48 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const xToPx = (i: number) =>
    xLabels.length === 1
      ? padding.left + innerW / 2
      : padding.left + (i / (xLabels.length - 1)) * innerW

  const allY = series.flatMap((s) => s.points.map((p) => p.y))
  const maxY = Math.max(1, ...allY)
  const yToPx = (v: number) => padding.top + innerH - (v / maxY) * innerH

  const fmt = formatY || ((n: number) => n.toLocaleString())

  // y-axis ticks (0, 25%, 50%, 75%, 100%)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    v: maxY * f,
    y: yToPx(maxY * f),
  }))

  return (
    <div className="w-full">
      {title && <div className="text-sm font-medium mb-2">{title}</div>}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[480px]"
          role="img"
          aria-label={title || 'Trend chart'}
        >
          {/* grid + y-axis ticks */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={t.y}
                y2={t.y}
                stroke="#e5e7eb"
                strokeDasharray={i === 0 ? '0' : '3 3'}
              />
              <text x={padding.left - 6} y={t.y + 3} fontSize="10" textAnchor="end" fill="#6b7280">
                {fmt(t.v)}
              </text>
            </g>
          ))}

          {/* x labels */}
          {xLabels.map((label, i) => (
            <text
              key={label}
              x={xToPx(i)}
              y={height - padding.bottom + 16}
              fontSize="10"
              textAnchor="middle"
              fill="#6b7280"
            >
              {label.length > 10 ? label.slice(5) : label}
            </text>
          ))}

          {/* lines */}
          {series.map((s) => {
            const pts = xLabels.map((label, i) => {
              const match = s.points.find((p) => p.x === label)
              return { x: xToPx(i), y: match ? yToPx(match.y) : null }
            })
            const d = pts
              .filter((p): p is { x: number; y: number } => p.y !== null)
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
              .join(' ')
            return (
              <g key={s.name}>
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} />
                {pts.map((p, i) =>
                  p.y !== null ? (
                    <circle key={i} cx={p.x} cy={p.y} r={3} fill={s.color}>
                      <title>
                        {s.name} · {xLabels[i]}:{' '}
                        {fmt(s.points.find((pt) => pt.x === xLabels[i])?.y || 0)}
                      </title>
                    </circle>
                  ) : null
                )}
              </g>
            )
          })}
        </svg>
      </div>
      {/* legend */}
      <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-600">
        {series.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-0.5"
              style={{ backgroundColor: s.color }}
            />
            <span>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
