import { useEffect, useRef, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import { ymText } from '../../lib/sim/period'

export type ChartSeries = { name: string; label: string; value: number[] }
export type ChartMode = 'amount' | 'pct'

type Props = {
  labels: string[]
  paid: number[]
  series: ChartSeries[]
  mode: ChartMode
}

function niceStep(range: number): number {
  const raw = Math.max(range, 1e-9) / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag
}

const pctOf = (v: number, p: number) => (p > 0 ? (v / p - 1) * 100 : null)
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`
/** 세로축 금액 — 억 단위면 "1.5억", 아니면 "3,000만" */
function axisMoney(v: number): string {
  if (v === 0) return '0'
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(v % 1e8 === 0 ? 0 : 1)}억`
  return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`
}

/**
 * 넣은 돈(점선)과 구성별 평가금 — 금액 축, 또는 넣은 돈 대비 %(0% = 원금) 축.
 * 화면 폭에 맞춰 그리고, 짚은 달의 값은 툴팁으로 본다(모아가기 PeriodChart와 같은 방식).
 */
export default function AmountChart({ labels, paid, series, mode }: Props) {
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

  const n = labels.length - 1
  if (n < 1) return null
  // % 축은 넣은 돈이 생긴 달부터 (처음 가진 돈이 없으면 0개월째는 %가 없다)
  const first = mode === 'pct' ? Math.max(0, paid.findIndex((v) => v > 0)) : 0
  const ys = series.map((s) => s.value.map((v, i) => (mode === 'pct' ? pctOf(v, paid[i]) : v)))
  const paidY = paid.map((p) => (mode === 'pct' ? 0 : p))
  const all = [...ys.flatMap((y) => y.slice(first)), ...paidY.slice(first)].filter((v): v is number => v != null)
  const step = niceStep(Math.max(...all) - Math.min(...all, 0))
  const minY = Math.floor(Math.min(...all, 0) / step) * step
  const maxY = Math.ceil(Math.max(...all) / step) * step
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / n
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - minY) / (maxY - minY || 1))
  const path = (arr: Array<number | null>) => {
    let d = ''
    arr.forEach((v, i) => {
      if (i < first || v == null) return
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    })
    return d
  }
  const ticks: number[] = []
  for (let t = minY; t <= maxY + step * 1e-9; t += step) ticks.push(t)
  const every = n > 240 || W < 420 ? 4 : n > 120 ? 2 : 1
  const jan = labels.map((m, i) => ({ m, i })).filter(({ m }) => m.endsWith('01')).filter((_, k) => k % every === 0)
  const yearMarks = jan.length >= 2 ? jan.map(({ m, i }) => ({ i, text: m.slice(0, 4) })) : [{ i: 0, text: ymText(labels[0]) }, { i: n, text: ymText(labels[n]) }]

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    setHover(Math.min(n, Math.max(first, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * n))))
  }
  const tipLeft = hover == null ? 0 : x(hover) > W * 0.6 ? x(hover) - 212 : x(hover) + 12

  return (
    <div className="acc-chart-wrap ps-chart" ref={wrapRef}>
      <svg className="acc-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={mode === 'pct' ? '넣은 돈 대비 수익률 추이' : '넣은 돈과 구성별 평가금 추이'}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className={mode === 'pct' && Math.abs(t) < 1e-9 ? 'acc-grid ps-zero' : 'acc-grid'} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="acc-axis">{mode === 'pct' ? `${Math.round(t)}%` : axisMoney(t)}</text>
          </g>
        ))}
        {yearMarks.map(({ i, text }) => (
          <text key={`${i}-${text}`} x={x(i)} y={H - 8} textAnchor="middle" className="acc-axis">{text}</text>
        ))}
        {mode === 'amount' && <path d={path(paidY)} className="acc-line acc-paid" />}
        {ys.map((arr, k) => <path key={series[k].name} d={path(arr)} className={`acc-line ps-line ps-line--${series[k].name}`} />)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="acc-grid" />}
      </svg>
      {hover != null && (
        <div className="acc-tip ps-tip" style={{ left: tipLeft, top: PAD.t }} role="status">
          <strong>{ymText(labels[hover])}</strong>
          <span>넣은 돈 {formatKrwMan(paid[hover])}</span>
          {series.map((s) => {
            const v = s.value[hover]
            const p = pctOf(v, paid[hover])
            return <span key={s.name}><i className={`ps-key ps-key--${s.name}`} />{s.name} {formatKrwMan(v)}{p != null ? ` (${signed(p)})` : ''}</span>
          })}
        </div>
      )}
    </div>
  )
}
