import { useEffect, useRef, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import type { RollingPaths } from '../../lib/sim/engine'
import { ymText } from '../../lib/sim/period'
import type { ChartMode } from './AmountChart'

const MAX_DRAWN = 120
const axisMoney = (v: number) => (v === 0 ? '0' : Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(v % 1e8 === 0 ? 0 : 1)}억` : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`)

function niceStep(range: number): number {
  const raw = Math.max(range, 1e-9) / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag
}

/**
 * 같은 길이를 모든 시작 달로 돌린 경로 부채꼴 — 가는 선 하나가 시작 달 하나다. 가로축은 "시작 후 몇 년".
 * 원금 아래로 내려간 적 있는 경로는 붉게, 아닌 경로는 연하게 그리고, 하위 10%~상위 10% 띠·중앙선·고른 기간을 얹는다.
 * 랜덤 가정이 아니라 데이터 안에 실제로 있었던 시작 달들이다(서로 기간이 겹쳐 독립 표본은 아니다).
 */
export default function FanChart({ data, mode }: { data: RollingPaths; mode: ChartMode }) {
  const H = 260
  const PAD = { l: 52, r: 12, t: 12, b: 28 }
  const wrapRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      if (w > 0) setW(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = data.months
  if (n < 1) return null
  const first = Math.max(0, data.paid.findIndex((v) => v > 0))
  // 금액 축이면 배율 × 넣은 돈, % 축이면 (배율 − 1) × 100
  const val = (ratio: number, t: number) => (mode === 'pct' ? (ratio - 1) * 100 : ratio * data.paid[t])
  const stride = Math.max(1, Math.ceil(data.count / MAX_DRAWN))
  const drawn = data.paths.map((r, k) => ({ r, k })).filter(({ k }) => k % stride === 0)
  const lows: number[] = []
  const highs: number[] = []
  for (let t = first; t <= n; t += 1) {
    lows.push(val(Math.min(...drawn.map(({ r }) => r[t]).filter(Number.isFinite), data.chosen[t]), t))
    highs.push(val(Math.max(...drawn.map(({ r }) => r[t]).filter(Number.isFinite), data.chosen[t]), t))
  }
  const lo = Math.min(...lows.filter(Number.isFinite), 0)
  const hi = Math.max(...highs.filter(Number.isFinite), 0)
  const step = niceStep(hi - lo)
  const minY = Math.floor(lo / step) * step
  const maxY = Math.ceil(hi / step) * step
  const x = (t: number) => PAD.l + ((W - PAD.l - PAD.r) * t) / n
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - minY) / (maxY - minY || 1))
  const tStep = n > 120 ? 2 : 1
  const path = (ratios: number[]) => {
    let d = ''
    for (let t = first; t <= n; t += 1) {
      if (t !== n && (t - first) % tStep !== 0) continue
      if (!Number.isFinite(ratios[t])) continue
      d += `${d ? 'L' : 'M'}${x(t).toFixed(1)},${y(val(ratios[t], t)).toFixed(1)}`
    }
    return d
  }
  const band = (() => {
    const up: string[] = []
    const down: string[] = []
    for (let t = first; t <= n; t += 1) {
      if (!Number.isFinite(data.p90[t]) || !Number.isFinite(data.p10[t])) continue
      up.push(`${x(t).toFixed(1)},${y(val(data.p90[t], t)).toFixed(1)}`)
      down.push(`${x(t).toFixed(1)},${y(val(data.p10[t], t)).toFixed(1)}`)
    }
    return up.length ? `M${up.join('L')}L${down.reverse().join('L')}Z` : ''
  })()
  const ticks: number[] = []
  for (let v = minY; v <= maxY + step * 1e-9; v += step) ticks.push(v)
  const yearMarks = Array.from({ length: Math.floor(n / 12) + 1 }, (_, k) => k * 12)
    .filter((t) => t <= n)
    .filter((_, k, all) => all.length <= 8 || k % Math.ceil(all.length / 8) === 0)

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    setHover(Math.min(n, Math.max(first, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * n))))
  }
  const tipLeft = hover == null ? 0 : x(hover) > W * 0.6 ? x(hover) - 212 : x(hover) + 12
  const fmt = (ratio: number, t: number) => `${formatKrwMan(ratio * data.paid[t])} (${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(0)}%)`

  return (
    <div className="acc-chart-wrap ps-chart ps-fan" ref={wrapRef}>
      <svg className="acc-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`같은 기간을 시작 달 ${data.count}개로 돌린 경로. 원금 아래로 내려간 적 있는 경로 ${data.underwater}개`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={mode === 'pct' && Math.abs(v) < 1e-9 ? 'acc-grid ps-zero' : 'acc-grid'} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="acc-axis">{mode === 'pct' ? `${Math.round(v)}%` : axisMoney(v)}</text>
          </g>
        ))}
        {yearMarks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="acc-axis">{t === 0 ? '시작' : `${t / 12}년`}</text>
        ))}
        {mode === 'pct' && minY < 0 && <rect x={PAD.l} y={y(0)} width={W - PAD.l - PAD.r} height={y(minY) - y(0)} className="acc-loss-zone" />}
        {drawn.map(({ r, k }) => <path key={k} d={path(r)} className={data.isUnderwater[k] ? 'ps-fan-line ps-fan-line--down' : 'ps-fan-line'} />)}
        {band && <path d={band} className="ps-fan-band" />}
        <path d={path(data.median)} className="ps-fan-median" />
        <path d={path(data.chosen)} className="ps-fan-me" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="acc-grid" />}
      </svg>
      {hover != null && (
        <div className="acc-tip ps-tip" style={{ left: tipLeft, top: PAD.t }} role="status">
          <strong>시작 후 {Math.floor(hover / 12) > 0 ? `${Math.floor(hover / 12)}년 ` : ''}{hover % 12 ? `${hover % 12}개월` : ''}</strong>
          <span>넣은 돈 {formatKrwMan(data.paid[hover])}</span>
          <span>상위 10% {fmt(data.p90[hover], hover)}</span>
          <span>중앙 {fmt(data.median[hover], hover)}</span>
          <span>하위 10% {fmt(data.p10[hover], hover)}</span>
          <span>고른 기간({ymText(data.labels[hover])}) {fmt(data.chosen[hover], hover)}</span>
        </div>
      )}
    </div>
  )
}
