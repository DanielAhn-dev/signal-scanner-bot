export function StrategySparkline({ values }: { values: number[] }) {
  const safeValues = Array.isArray(values)
    ? values.filter((value) => Number.isFinite(Number(value))).map((value) => Number(value))
    : []
  if (safeValues.length < 2) {
    return <div className="scan-strategy-sparkline scan-strategy-sparkline--empty">신호 부족</div>
  }

  const width = 116
  const height = 26
  const min = Math.min(...safeValues)
  const max = Math.max(...safeValues)
  const span = Math.max(0.001, max - min)
  const stepX = safeValues.length > 1 ? width / (safeValues.length - 1) : width

  const points = safeValues
    .map((value, idx) => {
      const x = Math.round(idx * stepX * 100) / 100
      const y = Math.round((height - ((value - min) / span) * height) * 100) / 100
      return `${x},${y}`
    })
    .join(' ')

  const last = safeValues[safeValues.length - 1] ?? 0
  const trendClass = last >= 0 ? 'scan-strategy-sparkline--up' : 'scan-strategy-sparkline--down'

  return (
    <div className={`scan-strategy-sparkline ${trendClass}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="scan-strategy-sparkline__baseline" />
        {safeValues.map((value, idx) => {
          const x = safeValues.length > 1 ? idx * stepX : width / 2
          const normalized = (value - min) / span
          const barHeight = Math.max(2, normalized * height)
          const y = height - barHeight
          return (
            <rect
              key={`spark-bar-${idx}`}
              x={Math.max(0, x - 1)}
              y={y}
              width="2"
              height={barHeight}
              className="scan-strategy-sparkline__bar"
            />
          )
        })}
        <polyline points={points} className="scan-strategy-sparkline__line" />
      </svg>
    </div>
  )
}

export function ConfirmTrendSparkline({ values }: { values: number[] }) {
  const safeValues = Array.isArray(values)
    ? values.filter((value) => Number.isFinite(Number(value))).map((value) => Number(value))
    : []

  if (safeValues.length < 2) {
    return <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>추세 데이터 부족</span>
  }

  const width = 72
  const height = 16
  const min = Math.min(...safeValues)
  const max = Math.max(...safeValues)
  const span = Math.max(0.1, max - min)
  const stepX = safeValues.length > 1 ? width / (safeValues.length - 1) : width
  const points = safeValues
    .map((value, idx) => {
      const x = Math.round(idx * stepX * 100) / 100
      const y = Math.round((height - ((value - min) / span) * height) * 100) / 100
      return `${x},${y}`
    })
    .join(' ')
  const last = safeValues[safeValues.length - 1] ?? 0
  const first = safeValues[0] ?? 0
  const trendUp = last >= first

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ width: 72, height: 16, verticalAlign: 'middle', marginLeft: 4 }}
    >
      <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} stroke="var(--color-border-subtle)" strokeWidth="1" />
      <polyline
        points={points}
        fill="none"
        stroke={trendUp ? 'var(--color-stock-up)' : 'var(--color-stock-down)'}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
