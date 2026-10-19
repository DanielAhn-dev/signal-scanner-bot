import { KOSPI_HISTORY } from '../../lib/accumulate'
import { drawdownEpisodes, monthsLabel } from '../../lib/drawdownEpisodes'

const ym = (s: string) => `${s.slice(0, 4)}.${Number(s.slice(4, 6))}`
/** 비교 대상 — 월말 기준 고점 대비 −15% 이상 빠졌다가 회복한 구간 */
const MIN_DEPTH = -15

/**
 * 하락 카드 '자세히' — 과거 큰 하락 구간들 위에 지금 고점 대비 위치를 세로선으로.
 * "지금이 바닥"이라는 예측이 아니라, 지금 숫자가 과거 큰 하락들에 비해 어느 정도인지와 회복에 걸린 시간을 보여 준다.
 * 회복하지 못한 진행 중 구간은 비교 목록에서 뺀다(지금 위치가 그 구간이다).
 */
export default function DrawdownPosition({ fromHighPct }: { fromHighPct: number }) {
  const past = drawdownEpisodes(KOSPI_HISTORY.monthly, MIN_DEPTH).filter((e) => e.recoverYm != null)
  if (!past.length || !Number.isFinite(fromHighPct)) return null
  const now = Math.min(0, fromHighPct)
  const deepest = Math.min(...past.map((e) => e.depthPct), now)
  const scale = Math.ceil(Math.abs(deepest) / 10) * 10
  const W = 360
  const rowH = 17
  const top = 14
  const labelW = 64
  const right = 92
  const H = top + past.length * rowH + 16
  const x = (pct: number) => labelW + (Math.abs(pct) / scale) * (W - labelW - right)
  const recovers = past.map((e) => e.monthsToRecover as number).sort((a, b) => a - b)
  const medianRecover = recovers[Math.floor((recovers.length - 1) / 2)]
  // '지금보다 더 내려간 횟수'는 넣지 않는다 — −15% 넘은 구간만 골랐으니 늘 높게 나와 더 빠진다는 예측처럼 읽힌다
  const shallowest = Math.max(...past.map((e) => e.depthPct))
  const first = KOSPI_HISTORY.monthly[0][0]
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: 520, height: 'auto' }} role="img"
        aria-label={`과거 큰 하락 ${past.length}번과 지금 고점 대비 ${now.toFixed(1)}%. 회복까지 중앙값 ${monthsLabel(medianRecover)}`}>
        <text x={labelW} y={9} style={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }}>고점 대비 저점</text>
        <text x={W - 2} y={9} textAnchor="end" style={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }}>고점 회복까지</text>
        {past.map((e, i) => {
          const yy = top + i * rowH
          return (
            <g key={e.peakYm}>
              <text x={0} y={yy + 11} style={{ fill: 'var(--color-text-secondary)', fontSize: 9.5 }}>{ym(e.peakYm)}~</text>
              <rect x={labelW} y={yy + 3} width={Math.max(1, x(e.depthPct) - labelW)} height={rowH - 7} rx={2} style={{ fill: 'var(--color-stock-down)', fillOpacity: 0.55 }} />
              <text x={x(e.depthPct) + 3} y={yy + 11} style={{ fill: 'var(--color-text-secondary)', fontSize: 9.5 }}>{e.depthPct.toFixed(0)}%</text>
              <text x={W - 2} y={yy + 11} textAnchor="end" style={{ fill: 'var(--color-text-secondary)', fontSize: 9.5 }}>{monthsLabel(e.monthsToRecover as number)}</text>
            </g>
          )
        })}
        <line x1={x(now)} x2={x(now)} y1={top - 2} y2={H - 13} style={{ stroke: 'var(--color-text-primary)', strokeWidth: 1.5, strokeDasharray: '3 2' }} />
        <text x={x(now)} y={H - 3} textAnchor="middle" style={{ fill: 'var(--color-text-primary)', fontSize: 9.5, fontWeight: 700 }}>지금 {now.toFixed(0)}%</text>
      </svg>
      <div>
        세로 점선이 <strong>지금 고점 대비 {now.toFixed(1)}%</strong>입니다. {first.slice(0, 4)}년 이후 월말 기준 −15% 넘게 빠진 적은 {past.length}번(저점 {shallowest.toFixed(0)}%에서 {Math.min(...past.map((e) => e.depthPct)).toFixed(0)}%까지)이고,
        고점을 다시 넘기까지 중앙값 {monthsLabel(medianRecover)}(짧게는 {monthsLabel(recovers[0])}, 길게는 {monthsLabel(recovers[recovers.length - 1])}) 걸렸습니다.
        바닥이 어디인지는 아무도 모릅니다. 그래서 미리 정한 계획대로 하는 것입니다.
      </div>
      <div style={{ color: 'var(--color-text-tertiary)' }}>
        KODEX 200 월말 수정주가({first.slice(0, 4)}.{Number(first.slice(4))}~, 분배금 재투자) 기준이라 장중 저점보다 얕고 회복은 가격 지수보다 빠릅니다. 지금 값은 코스피 종가 기준입니다.
      </div>
    </div>
  )
}
