import { formatKrwMan } from '../../lib/format'

export type IncomeBar = { month: string; total: number | null; kind: 'actual' | 'none' | 'projection' }

const nextMonth = (m: string) => {
  const y = Number(m.slice(0, 4))
  const mo = Number(m.slice(5, 7))
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
}

/**
 * 첫 기록 달(최대 n-1달 전)부터 이번 달까지 + 다음 달 예상. 기록이 없는 달은 0이 아니라 'none'
 * — 받지 않은 달인지 안 적은 달인지 모르므로 0으로 그리지 않는다.
 */
export function incomeBarSeries(monthTotals: Array<{ month: string; total: number }>, thisMonth: string, projection: number, n = 12): IncomeBar[] {
  const by = new Map(monthTotals.map((g) => [g.month, g.total]))
  const all: string[] = []
  let m = thisMonth
  for (let i = 0; i < n - 1; i += 1) {
    all.unshift(m)
    const y = Number(m.slice(0, 4))
    const mo = Number(m.slice(5, 7))
    m = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`
  }
  const first = all.findIndex((x) => by.has(x))
  const shown = first < 0 ? [thisMonth] : all.slice(first)
  return [
    ...shown.map((month): IncomeBar => (by.has(month) ? { month, total: by.get(month)!, kind: 'actual' } : { month, total: null, kind: 'none' })),
    { month: nextMonth(thisMonth), total: projection, kind: 'projection' },
  ]
}

const short = (v: number) => (v >= 10_000 ? `${Math.round(v / 10_000).toLocaleString('ko-KR')}만` : `${Math.round(v / 1000)}천`)

/**
 * 받은 분배금(세후) 달별 막대 + 다음 달 예상(옅은 막대) + 목표 월 인컴 선.
 * 분배금은 분기·월 지급이 섞여 달마다 들쭉날쭉하므로 최근 3달 평균도 함께 보여 준다.
 */
export default function IncomeBars({ bars, goal }: { bars: IncomeBar[]; goal: number | null }) {
  const actual = bars.filter((b) => b.kind === 'actual')
  if (!actual.length) return null
  const W = 360
  const H = 150
  const pad = { l: 8, r: 8, t: 16, b: 20 }
  const maxV = Math.max(1, goal ?? 0, ...bars.map((b) => b.total ?? 0)) * 1.12
  const slot = (W - pad.l - pad.r) / bars.length
  const bw = Math.min(22, slot * 0.62)
  const cx = (i: number) => pad.l + slot * (i + 0.5)
  const y = (v: number) => pad.t + (1 - v / maxV) * (H - pad.t - pad.b)
  const last3 = bars.filter((b) => b.kind !== 'projection').slice(-3)
  const avg3 = last3.length === 3 && last3.every((b) => b.kind === 'actual') ? last3.reduce((s, b) => s + (b.total ?? 0), 0) / 3 : null
  const proj = bars[bars.length - 1]
  return (
    <div style={{ marginTop: 10 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: 560, height: 'auto' }} role="img"
        aria-label={`달별 받은 분배금 ${actual.length}개월, 다음 달 예상 ${formatKrwMan(proj.total ?? 0)}${goal ? `, 목표 월 ${formatKrwMan(goal)}` : ''}`}>
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--color-border-default)' }} />
        {bars.map((b, i) => {
          const label = `${Number(b.month.slice(5))}월`
          return (
            <g key={b.month}>
              {b.kind === 'none' ? (
                <text x={cx(i)} y={y(0) - 3} textAnchor="middle" style={{ fill: 'var(--color-text-tertiary)', fontSize: 8 }}>·</text>
              ) : (
                <rect x={cx(i) - bw / 2} y={y(b.total ?? 0)} width={bw} height={Math.max(0.5, y(0) - y(b.total ?? 0))} rx={2}
                  style={b.kind === 'projection'
                    ? { fill: 'var(--color-brand)', fillOpacity: 0.18, stroke: 'var(--color-brand)', strokeDasharray: '3 2', strokeWidth: 1 }
                    : { fill: 'var(--color-brand)' }} />
              )}
              {b.total != null && b.total > 0 && (bars.length <= 7 || i === bars.length - 1 || i === bars.length - 2) && (
                <text x={b.kind === 'projection' ? cx(i) + bw / 2 : cx(i)} y={y(b.total) - 3} textAnchor={b.kind === 'projection' ? 'end' : 'middle'} style={{ fill: 'var(--color-text-secondary)', fontSize: 9 }}>{b.kind === 'projection' ? `예상 ${short(b.total)}` : short(b.total)}</text>
              )}
              <text x={cx(i)} y={H - 6} textAnchor="middle" style={{ fill: b.kind === 'projection' ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)', fontSize: 9, fontWeight: b.kind === 'projection' ? 600 : 400 }}>
                {bars.length > 9 && i % 2 === 1 && i < bars.length - 2 ? '' : label}
              </text>
            </g>
          )
        })}
        {goal != null && goal > 0 && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(goal)} y2={y(goal)} style={{ stroke: 'var(--color-text-secondary)', strokeDasharray: '6 3', strokeWidth: 1 }} />
            <text x={pad.l + 2} y={y(goal) - 4} style={{ fill: 'var(--color-text-secondary)', fontSize: 9, fontWeight: 600 }}>목표 월 {short(goal)}</text>
          </g>
        )}
      </svg>
      <div style={{ color: 'var(--color-text-tertiary)', fontSize: 12, wordBreak: 'keep-all' }}>
        {avg3 != null && <>최근 3달 평균 <strong style={{ color: 'var(--color-text-secondary)' }}>{formatKrwMan(avg3)}</strong>{goal ? ` · 목표의 ${Math.round((avg3 / goal) * 100)}%` : ''}. </>}
        진한 막대는 적은 기록(세후), 옅은 막대는 다음 달 예상입니다. 점(·)은 기록이 없는 달입니다. 분기 지급 종목이 섞이면 달마다 들쭉날쭉하니 한 달보다 평균을 보세요.
      </div>
    </div>
  )
}
