import { useEffect, useRef, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import type { SimResult } from '../../lib/accumulate'

/**
 * 모아가기 3번 그래프 — 세로축은 금액이 아니라 "넣은 돈 대비 %"(0% = 원금).
 * 금액으로 그리면 매달 넣는 돈이 쌓여 어느 시작점이든 오른쪽 위로 올라가 보이고, 원금 아래로 빠진 구간이 원금선과 몇 픽셀 차이로 묻혔다(2026-10-19 사용자 지적).
 * 분위수는 같은 시점의 시작점들 사이에서 낸 것이라, 그 시점 넣은 돈(모두 같다)으로 나눠도 순서가 그대로다.
 * 화면 폭에 맞춰 그리므로 휴대폰에서도 글자가 줄지 않고, 짚은 시점의 값은 툴팁으로 본다.
 */
const H = 260
const PAD = { l: 44, r: 12, t: 12, b: 28 }

const pct = (value: number, paid: number) => (paid > 0 ? (value / paid - 1) * 100 : 0)
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`
const ymLabel = (ym: string) => (ym.length === 6 ? `${ym.slice(0, 4)}-${ym.slice(4)}` : ym)
const stepLabel = (i: number) => (i < 12 ? `${i}개월` : i % 12 === 0 ? `${i / 12}년` : `${Math.floor(i / 12)}년 ${i % 12}개월`)

function niceStep(range: number): number {
  const raw = range / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag
}

export default function FanChart({ sim }: { sim: SimResult }) {
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

  const n = sim.months
  // 처음 가진 돈이 없으면 0개월째는 넣은 돈이 0이라 %가 없다 — 1개월째부터 그린다
  const first = sim.paid[0] > 0 ? 0 : 1
  const steps = Array.from({ length: n - first + 1 }, (_, k) => k + first)
  const real = sim.deepest
  const series = {
    p90: steps.map((i) => pct(sim.p90[i], sim.paid[i])),
    median: steps.map((i) => pct(sim.median[i], sim.paid[i])),
    p10: steps.map((i) => pct(sim.p10[i], sim.paid[i])),
    worst: steps.map((i) => pct(sim.worst[i], sim.paid[i])),
    real: real ? steps.map((i) => pct(real.value[i], sim.paid[i])) : null,
  }
  const all = [...series.p90, ...series.worst, ...(series.real ?? []), 0]
  const step = niceStep(Math.max(...all) - Math.min(...all))
  const minY = Math.floor(Math.min(...all) / step) * step
  const maxY = Math.ceil(Math.max(...all) / step) * step
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / n
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - minY) / (maxY - minY || 1))
  const line = (arr: number[]) => arr.map((v, k) => `${k ? 'L' : 'M'}${x(steps[k]).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const band = `${line(series.p90)} ${[...series.p10].reverse().map((v, k) => `L${x(steps[steps.length - 1 - k]).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} Z`
  const ticks: number[] = []
  for (let t = minY; t <= maxY + 1e-9; t += step) ticks.push(Math.round(t))
  const yearEvery = n > 96 ? 2 : 1
  const years = Array.from({ length: Math.floor(n / 12) + 1 }, (_, k) => k * 12).filter((m) => (m / 12) % yearEvery === 0)
  const zeroY = y(0)
  const trough = real && real.troughStep >= first ? { cx: x(real.troughStep), cy: y(real.troughPct) } : null

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * n)
    setHover(Math.min(n, Math.max(first, i)))
  }
  const k = hover == null ? -1 : hover - first
  const tipLeft = hover == null ? 0 : x(hover) > W * 0.6 ? x(hover) - 196 : x(hover) + 12

  return (
    <div className="acc-chart-wrap" ref={wrapRef}>
      <svg
        className="acc-chart"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="적립 평가금 추이: 넣은 돈 대비 %, 중앙값·하위10%·최악·실제 한 사람"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* 원금 아래 = 손해 구간 */}
        {minY < 0 && <rect x={PAD.l} y={zeroY} width={W - PAD.l - PAD.r} height={y(minY) - zeroY} className="acc-loss-zone" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'acc-zero' : 'acc-grid'} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="acc-axis">{t === 0 ? '원금' : signed(t)}</text>
          </g>
        ))}
        {years.map((m) => <text key={m} x={x(m)} y={H - 8} textAnchor="middle" className="acc-axis">{m / 12}년</text>)}
        <path d={band} className="acc-band" />
        <path d={line(series.worst)} className="acc-line acc-worst" />
        <path d={line(series.p10)} className="acc-line acc-p10" />
        <path d={line(series.median)} className="acc-line acc-median" />
        {/* 분위수 선은 시점마다 다른 시작점 값을 이어 매끈하다 — 한 사람이 실제로 겪은 길을 겹친다 */}
        {series.real && <path d={line(series.real)} className="acc-line acc-real" />}
        {trough && <circle cx={trough.cx} cy={trough.cy} r={4} className="acc-trough" />}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="acc-crosshair" />
            <circle cx={x(hover)} cy={y(series.median[k])} r={4} className="acc-dot acc-dot--median" />
            {series.real && <circle cx={x(hover)} cy={y(series.real[k])} r={4} className="acc-dot acc-dot--real" />}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="acc-tip" style={{ left: tipLeft, top: PAD.t }} role="status">
          <strong>{stepLabel(hover)} · 넣은 돈 {formatKrwMan(sim.paid[hover])}</strong>
          <span><i className="acc-k-median" />중앙값 {signed(series.median[k])} ({formatKrwMan(sim.median[hover])})</span>
          <span><i className="acc-k-p10" />하위10% {signed(series.p10[k])} ({formatKrwMan(sim.p10[hover])})</span>
          <span><i className="acc-k-worst" />최악 {signed(series.worst[k])} ({formatKrwMan(sim.worst[hover])})</span>
          {real && series.real && <span><i className="acc-k-real" />{ymLabel(real.start)} 시작 {signed(series.real[k])} ({formatKrwMan(real.value[hover])})</span>}
        </div>
      )}
    </div>
  )
}
