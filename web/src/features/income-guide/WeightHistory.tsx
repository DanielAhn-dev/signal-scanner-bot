import { REBALANCE_BAND_PP } from '../../../../src/lib/incomeGuide'

type Group = 'growth' | 'income' | 'satellite' | 'cash'
type Entry = { date: string; groups: Array<{ group: Group; actualPct: number; targetPct: number }> }
export type WeightPoint = { day: number; date: string; actual: number; target: number }

const GROUPS: Array<{ group: Group; label: string }> = [
  { group: 'growth', label: '성장(지수)' },
  { group: 'income', label: '인컴(분배형)' },
  { group: 'satellite', label: '위성(개별주)' },
  { group: 'cash', label: '현금성' },
]
const DAY = 86_400_000

/** 바구니 하나의 기록 — 날짜순, 같은 날 여러 번이면 마지막 기록. day는 첫 기록부터 지난 날 수 */
export function weightSeries(history: Entry[], group: Group): WeightPoint[] {
  const byDate = new Map<string, { actual: number; target: number }>()
  for (const h of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    const g = h.groups.find((x) => x.group === group)
    if (g) byDate.set(h.date.slice(0, 10), { actual: g.actualPct, target: g.targetPct })
  }
  const dates = [...byDate.keys()]
  if (!dates.length) return []
  const t0 = Date.parse(`${dates[0]}T00:00:00Z`)
  return dates.map((date) => ({ day: Math.round((Date.parse(`${date}T00:00:00Z`) - t0) / DAY), date, ...byDate.get(date)! }))
}

const shortDate = (d: string) => `${d.slice(2, 4)}.${Number(d.slice(5, 7))}`

/**
 * 점검 기록을 바구니별 작은 그래프로 — 회색 띠가 목표 ±10%p(리밸런싱 판단 기준), 선이 실제 비중.
 * 띠 안이면 할 일이 없다는 것을 숫자 표보다 먼저 보이게 한다. 수익률은 넣지 않는다(계좌 건강과 같은 원칙).
 */
export default function WeightHistory({ history }: { history: Entry[] }) {
  const rows = GROUPS.map((g) => ({ ...g, pts: weightSeries(history, g.group) })).filter((r) => r.pts.length >= 2 && r.pts.some((p) => p.actual > 0 || p.target > 0))
  if (!rows.length) return null
  const W = 160
  const H = 64
  const pad = { l: 4, r: 4, t: 6, b: 14 }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 8 }}>
      {rows.map(({ group, label, pts }) => {
        const last = pts[pts.length - 1]
        const span = Math.max(1, last.day)
        const lo = Math.max(0, Math.min(...pts.map((p) => Math.min(p.actual, p.target - REBALANCE_BAND_PP))) - 2)
        const hi = Math.min(100, Math.max(...pts.map((p) => Math.max(p.actual, p.target + REBALANCE_BAND_PP))) + 2)
        const x = (d: number) => pad.l + (d / span) * (W - pad.l - pad.r)
        const y = (v: number) => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b)
        const band =
          pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(Math.min(100, p.target + REBALANCE_BAND_PP)).toFixed(1)}`).join('') +
          [...pts].reverse().map((p) => `L${x(p.day).toFixed(1)},${y(Math.max(0, p.target - REBALANCE_BAND_PP)).toFixed(1)}`).join('') + 'Z'
        const outNow = Math.abs(last.actual - last.target) > REBALANCE_BAND_PP
        const outCount = pts.filter((p) => Math.abs(p.actual - p.target) > REBALANCE_BAND_PP).length
        return (
          <figure key={group} style={{ margin: 0, padding: '6px 8px', border: '1px solid var(--color-border-default)', borderRadius: 6 }}>
            <figcaption style={{ display: 'flex', justifyContent: 'space-between', gap: 4, fontSize: 12, wordBreak: 'keep-all' }}>
              <strong>{label}</strong>
              <span style={{ color: outNow ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                {last.actual.toFixed(0)}% / 목표 {last.target.toFixed(0)}%
              </span>
            </figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', height: 'auto' }} role="img"
              aria-label={`${label} 비중 기록 ${pts.length}번, 목표 ±${REBALANCE_BAND_PP}%p 밖 ${outCount}번, 지금 ${last.actual.toFixed(0)}%`}>
              <path d={band} style={{ fill: 'var(--color-text-tertiary)', opacity: 0.15 }} />
              <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.target).toFixed(1)}`).join('')}
                style={{ fill: 'none', stroke: 'var(--color-text-tertiary)', strokeWidth: 1, strokeDasharray: '3 2' }} />
              <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.actual).toFixed(1)}`).join('')}
                style={{ fill: 'none', stroke: 'var(--color-brand)', strokeWidth: 1.75 }} />
              {pts.map((p) => Math.abs(p.actual - p.target) > REBALANCE_BAND_PP && (
                <circle key={p.date} cx={x(p.day)} cy={y(p.actual)} r={2.5} style={{ fill: 'var(--color-error)' }} />
              ))}
              <text x={pad.l} y={H - 3} style={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }}>{shortDate(pts[0].date)}</text>
              <text x={W - pad.r} y={H - 3} textAnchor="end" style={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }}>{shortDate(last.date)}</text>
            </svg>
          </figure>
        )
      })}
      <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--color-text-tertiary)', wordBreak: 'keep-all' }}>
        실선은 실제 비중, 점선은 목표, 회색 띠는 목표 ±{REBALANCE_BAND_PP}%p입니다. 띠 안이면 할 일이 없고, 빨간 점은 띠를 벗어난 기록입니다.
      </div>
    </div>
  )
}
