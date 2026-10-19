import { buildGoalPath, yearTicks, type Pt } from '../../lib/goalPath'
import type { GoalView } from './useGoalTracker'

/** 축 눈금용 짧은 금액 — "3억", "1.5억", "5,000만" */
function short(v: number): string {
  if (v >= 1e8) return `${Number((v / 1e8).toFixed(v % 1e8 === 0 ? 0 : 1))}억`
  return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`
}

/** 1·2·5 × 10^n 중 maxY를 4칸 안팎으로 나누는 간격 */
function niceStep(maxY: number): number {
  const raw = maxY / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? raw
}

/**
 * 목표 화면 "지나온 길 · 지금 · 앞으로" — 실제 평가액(월말 기록), 시작부터의 계획선, 지금부터 계획대로면, 수익 0%면.
 * 앞으로 선은 하나의 가정(연 계획 수익률)이라 보장처럼 보이지 않게 점선 대신 반투명 + 아래 문구로 한계를 밝힌다.
 * 색에만 기대지 않도록 선 모양(실선·점선·굵기)을 모두 다르게 한다.
 */
export default function GoalPathChart({ view }: { view: GoalView }) {
  const s = view.settings
  const p = buildGoalPath({
    today: view.today,
    settings: s,
    equity: view.equity,
    requiredSeed: view.target.requiredSeed,
    monthsToReach: view.target.monthsToReach,
    trail: view.trail,
  })
  const retireX = view.life && view.life.monthsToRetire > 0 && p.nowX + view.life.monthsToRetire <= p.endX ? p.nowX + view.life.monthsToRetire : null

  const W = 360
  const H = 210
  const pad = { l: 40, r: 10, t: 14, b: 22 }
  const all = [...p.plan, ...p.actual, ...p.future].map((q) => q.v)
  const top = Math.max(1, p.goal ?? 0, ...all) * 1.06
  const step = niceStep(top)
  const maxY = Math.ceil(top / step) * step
  const x = (v: number) => pad.l + (p.endX <= 0 ? 0 : (v / p.endX) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - Math.max(0, v) / maxY) * (H - pad.t - pad.b)
  const line = (pts: Pt[]) => pts.map((q, i) => `${i ? 'L' : 'M'}${x(q.x).toFixed(1)},${y(q.v).toFixed(1)}`).join('')
  const ticks: number[] = []
  for (let v = 0; v <= maxY + 1; v += step) ticks.push(v)
  const years = yearTicks(s.startDate, p.endX)
  const hasActual = p.actual.length > 1
  const etaLabelX = p.etaX != null ? Math.min(x(p.etaX), W - pad.r - 2) : 0

  return (
    <div className="goal-path">
      <svg className="goal-path__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`목표까지의 길: 시작 ${short(s.startEquity)}, 지금 ${short(view.equity)}${p.goal ? `, 필요 시드 ${short(p.goal)}` : ''}${view.target.etaMonth ? `, 계획대로면 ${view.target.etaMonth} 도달` : ''}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="goal-path__grid" />
            <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" className="goal-path__tick">{short(t)}</text>
          </g>
        ))}
        {years.map((t) => (
          <text key={t.x} x={x(t.x)} y={H - 6} textAnchor="middle" className="goal-path__tick">{t.year}</text>
        ))}
        {/* 지금 — 지나온 길과 앞으로를 나누는 세로선 */}
        {p.endX > p.nowX && <line x1={x(p.nowX)} x2={x(p.nowX)} y1={pad.t} y2={H - pad.b} className="goal-path__now-rule" />}
        {retireX != null && (
          <g>
            <line x1={x(retireX)} x2={x(retireX)} y1={pad.t} y2={H - pad.b} className="goal-path__marker" />
            <text x={x(retireX) - 3} y={H - pad.b - 4} textAnchor="end" className="goal-path__tick">은퇴 {view.life!.retireAge}세</text>
          </g>
        )}
        {p.goal != null && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(p.goal)} y2={y(p.goal)} className="goal-path__goal" />
            <text x={pad.l + 4} y={y(p.goal) - 4} className="goal-path__label">필요 시드 {short(p.goal)}</text>
          </g>
        )}
        <path d={line(p.plan)} className="goal-path__plan" />
        {p.aheadMonths > 0 && <path d={line(p.noReturn)} className="goal-path__zero" />}
        {p.aheadMonths > 0 && <path d={line(p.future)} className="goal-path__future" />}
        {hasActual && <path d={line(p.actual)} className="goal-path__actual" />}
        {p.etaX != null && p.goal != null && (
          <g>
            <circle cx={x(p.etaX)} cy={y(p.goal)} r={3.5} className="goal-path__eta" />
            <text x={etaLabelX} y={y(p.goal) + 14} textAnchor="end" className="goal-path__label">{view.target.etaMonth}</text>
          </g>
        )}
        <circle cx={x(p.nowX)} cy={y(view.equity)} r={4.5} className="goal-path__dot" />
        <text x={x(p.nowX) + 6} y={y(view.equity) - 6} className="goal-path__label">지금</text>
      </svg>
      <div className="goal-path__legend">
        {hasActual && <span><i className="goal-path__key goal-path__key--actual" />실제 평가액(월말)</span>}
        <span><i className="goal-path__key goal-path__key--plan" />계획선({s.startDate.slice(0, 7)}부터)</span>
        {p.aheadMonths > 0 && <span><i className="goal-path__key goal-path__key--future" />지금부터 연 {s.planAnnualPct}%면</span>}
        {p.aheadMonths > 0 && <span><i className="goal-path__key goal-path__key--zero" />수익 0%면(넣은 돈만)</span>}
      </div>
      <p className="goal-note">
        {p.aheadMonths > 0
          ? <>앞으로 선은 연 {s.planAnnualPct}%가 매년 고르게 나온다는 가정입니다. 실제로는 해마다 다르고, {view.normalRange.source} 기준 마이너스 달이 최장 {view.normalRange.maxLosingStreak}개월 이어졌습니다. 시장이 빠지면 회색 선 아래로도 내려갑니다.{p.etaX == null && p.goal != null ? ` 계획대로면 도달이 ${view.target.etaMonth ?? '50년 이상 뒤'}라 그래프(앞으로 ${p.aheadMonths / 12}년) 밖입니다.` : ''}</>
          : '필요 시드에 도달했습니다. 위 선은 지금까지의 기록입니다.'}
        {!hasActual && ' 실제 평가액 선은 월말 기록이 쌓이면 그려집니다.'}
      </p>
    </div>
  )
}
