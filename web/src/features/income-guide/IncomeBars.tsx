import { formatKrwMan } from '../../lib/format'

/** current = 이번 달 — total은 지금까지 적은 몫(없으면 null), expected는 월 평균 예상. 적을수록 예상 막대가 채워진다 */
export type IncomeBar = { month: string; total: number | null; kind: 'actual' | 'none' | 'current'; expected?: number }

/**
 * 첫 기록 달(최대 n-1달 전)부터 이번 달까지. 기록이 없는 달은 0이 아니라 'none'
 * — 받지 않은 달인지 안 적은 달인지 모르므로 0으로 그리지 않는다.
 * 이번 달은 다음 달 칸을 따로 만들지 않고 같은 막대 안에서 '적은 몫 + 아직 안 적은 예상 몫'으로 보여 준다.
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
  return shown.map((month): IncomeBar => {
    if (month === thisMonth) return { month, total: by.get(month) ?? null, kind: 'current', expected: projection }
    return by.has(month) ? { month, total: by.get(month)!, kind: 'actual' } : { month, total: null, kind: 'none' }
  })
}

const short = (v: number) => (v >= 10_000 ? `${Math.round(v / 10_000).toLocaleString('ko-KR')}만` : `${Math.round(v / 1000)}천`)

/**
 * 받은 분배금(세후) 달별 막대 + 이번 달 예상(옅은 막대, 적을수록 채워짐) + 목표 월 인컴 선.
 * 분배금은 분기·월 지급이 섞여 달마다 들쭉날쭉하므로 최근 3달 평균도 함께 보여 준다.
 */
export default function IncomeBars({ bars, goal }: { bars: IncomeBar[]; goal: number | null }) {
  const actual = bars.filter((b) => b.kind === 'actual')
  const current = bars.find((b) => b.kind === 'current')
  if (!actual.length && !(current?.total && current.total > 0)) return null
  const W = 360
  const H = 150
  const pad = { l: 8, r: 8, t: 16, b: 20 }
  const maxV = Math.max(1, goal ?? 0, ...bars.map((b) => Math.max(b.total ?? 0, b.expected ?? 0))) * 1.12
  const slot = (W - pad.l - pad.r) / bars.length
  const bw = Math.min(22, slot * 0.62)
  const cx = (i: number) => pad.l + slot * (i + 0.5)
  const y = (v: number) => pad.t + (1 - v / maxV) * (H - pad.t - pad.b)
  // 평균은 끝난 달만 — 이번 달은 아직 다 안 들어왔다
  const last3 = bars.filter((b) => b.kind !== 'current').slice(-3)
  const avg3 = last3.length === 3 && last3.every((b) => b.kind === 'actual') ? last3.reduce((s, b) => s + (b.total ?? 0), 0) / 3 : null
  return (
    <div style={{ marginTop: 10 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: 560, height: 'auto' }} role="img"
        aria-label={`달별 받은 분배금 ${actual.length}개월${current ? `, 이번 달 ${formatKrwMan(current.total ?? 0)} 받음·예상 ${formatKrwMan(current.expected ?? 0)}` : ''}${goal ? `, 목표 월 ${formatKrwMan(goal)}` : ''}`}>
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--color-border-default)' }} />
        {bars.map((b, i) => {
          const label = `${Number(b.month.slice(5))}월`
          const isCurrent = b.kind === 'current'
          const done = b.total ?? 0
          const top = Math.max(done, b.expected ?? 0)
          return (
            <g key={b.month}>
              {b.kind === 'none' ? (
                <text x={cx(i)} y={y(0) - 3} textAnchor="middle" style={{ fill: 'var(--color-text-tertiary)', fontSize: 8 }}>·</text>
              ) : (
                <>
                  {isCurrent && top > done && (
                    <rect x={cx(i) - bw / 2} y={y(top)} width={bw} height={Math.max(0.5, y(0) - y(top))} rx={2}
                      style={{ fill: 'var(--color-brand)', fillOpacity: 0.18, stroke: 'var(--color-brand)', strokeDasharray: '3 2', strokeWidth: 1 }} />
                  )}
                  {done > 0 && (
                    <rect x={cx(i) - bw / 2} y={y(done)} width={bw} height={Math.max(0.5, y(0) - y(done))} rx={2} style={{ fill: 'var(--color-brand)' }} />
                  )}
                </>
              )}
              {top > 0 && (isCurrent || bars.length <= 7 || i === bars.length - 2) && (
                <text x={isCurrent ? cx(i) + bw / 2 : cx(i)} y={y(top) - 3} textAnchor={isCurrent ? 'end' : 'middle'} style={{ fill: 'var(--color-text-secondary)', fontSize: 9 }}>
                  {isCurrent ? `${done > 0 ? `${short(done)} / ` : ''}예상 ${short(b.expected ?? 0)}` : short(done)}
                </text>
              )}
              <text x={cx(i)} y={H - 6} textAnchor="middle" style={{ fill: isCurrent ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)', fontSize: 9, fontWeight: isCurrent ? 600 : 400 }}>
                {bars.length > 9 && i % 2 === 1 && i < bars.length - 1 ? '' : label}
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
        진한 막대는 적은 기록(세후), 이번 달 옅은 막대는 아직 안 적은 예상 몫(월 평균 기준)이라 기록할수록 채워집니다. 점(·)은 기록이 없는 달입니다. 분기 지급 종목이 섞이면 달마다 들쭉날쭉하니 한 달보다 평균을 보세요.
      </div>
    </div>
  )
}
