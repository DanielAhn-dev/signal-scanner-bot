import { useEffect, useMemo, useRef, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import { KOSPI_HISTORY, simulatePeriod, type PeriodResult } from '../../lib/accumulate'

const man = formatKrwMan
const ymLabel = (ym: string) => `${ym.slice(0, 4)}-${ym.slice(4)}`

/** 빠른 선택 — 시작월만 정하고 끝은 위에서 고른 기간(년)만큼, 데이터 끝을 넘으면 마지막 달까지 */
const PRESETS: Array<{ label: string; start: string }> = [
  { label: '2008 금융위기 직전', start: '200710' },
  { label: '2020 코로나 직전', start: '202001' },
  { label: '2026년 6월 고점', start: '202606' },
]

const pctOf = (value: number, paid: number) => (paid > 0 ? (value / paid - 1) * 100 : 0)
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`

function niceStep(range: number): number {
  const raw = Math.max(range, 1) / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag
}

/**
 * 고른 기간 그래프 — 3번 위 그래프와 같은 기준으로 세로축은 "넣은 돈 대비 %"(0% = 원금).
 * 금액 축이면 매달 넣는 돈이 쌓여 어느 기간이든 오른쪽 위로 올라가 보여서, 원금 아래로 빠진 기간이 묻혔다.
 * 화면 폭에 맞춰 그리고, 짚은 달의 값은 툴팁으로 본다.
 */
function PeriodChart({ r }: { r: PeriodResult }) {
  const H = 260
  const PAD = { l: 44, r: 12, t: 12, b: 28 }
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

  const n = r.months
  // 처음 가진 돈이 없으면 0개월째는 넣은 돈이 0이라 %가 없다 — 넣은 돈이 생긴 달부터 그린다
  const first = Math.max(0, r.paid.findIndex((v) => v > 0))
  const steps = Array.from({ length: n - first + 1 }, (_, k) => k + first)
  const pcts = steps.map((i) => pctOf(r.value[i], r.paid[i]))
  const all = [...pcts, 0]
  const step = niceStep(Math.max(...all) - Math.min(...all))
  const minY = Math.floor(Math.min(...all) / step) * step
  const maxY = Math.ceil(Math.max(...all) / step) * step
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / n
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - minY) / (maxY - minY || 1))
  const path = pcts.map((v, k) => `${k ? 'L' : 'M'}${x(steps[k]).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const ticks: number[] = []
  for (let t = minY; t <= maxY + 1e-9; t += step) ticks.push(Math.round(t))
  const zeroY = y(0)
  // 가로축은 1월마다 연도 — 길거나 화면이 좁으면 걸러서, 너무 짧아 1월이 없으면 시작·끝 월
  const every = n > 120 || W < 420 ? 3 : n > 60 ? 2 : 1
  const jan = r.labels.map((m, i) => ({ m, i })).filter(({ m }) => m.endsWith('01')).filter((_, k) => k % every === 0)
  const yearMarks = jan.length >= 2 ? jan.map(({ m, i }) => ({ i, text: m.slice(0, 4) })) : [{ i: 0, text: ymLabel(r.labels[0]) }, { i: n, text: ymLabel(r.labels[n]) }]
  const trough = r.trough && r.trough.step >= first ? { cx: x(r.trough.step), cy: y(pctOf(r.value[r.trough.step], r.paid[r.trough.step])) } : null

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
        aria-label="고른 기간의 평가금: 넣은 돈 대비 %"
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
        {yearMarks.map(({ i, text }) => <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 && jan.length < 2 ? 'start' : i === n && jan.length < 2 ? 'end' : 'middle'} className="acc-axis">{text}</text>)}
        <path d={path} className="acc-line acc-median" />
        {trough && r.trough && (
          <g>
            <circle cx={trough.cx} cy={trough.cy} r={4} className="acc-trough" />
            <text x={trough.cx} y={Math.min(H - PAD.b - 4, trough.cy + 18)} textAnchor="middle" className="acc-axis">{ymLabel(r.trough.ym)} {r.trough.pct.toFixed(0)}%</text>
          </g>
        )}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="acc-crosshair" />
            <circle cx={x(hover)} cy={y(pcts[k])} r={4} className="acc-dot acc-dot--median" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="acc-tip" style={{ left: tipLeft, top: PAD.t }} role="status">
          <strong>{ymLabel(r.labels[hover])} · 넣은 돈 {man(r.paid[hover])}</strong>
          <span><i className="acc-k-median" />평가금 {man(r.value[hover])} ({signed(pcts[k])})</span>
        </div>
      )}
    </div>
  )
}

/**
 * 3번 카드의 "기간 골라 보기" — 실제 월말 가격으로 고른 기간 하나를 따라간다.
 * 한 기간은 우연이 크므로, 같은 길이로 시작할 수 있었던 모든 시작점 중 어디쯤인지 항상 함께 보여 준다.
 */
/** series: 시뮬레이션 이력(기본 코스피200). 해외지수는 시작이 늦어 그 전 빠른 선택(2008 등)은 숨긴다 */
export default function PeriodSim({ monthly, lump, drag, years, series = KOSPI_HISTORY.monthly }: { monthly: number; lump: number; drag: number; years: number; series?: Array<[string, number]> }) {
  const months = useMemo(() => series.map(([m]) => m), [series])
  const presets = PRESETS.filter((p) => months.includes(p.start))
  const firstStart = presets[0]?.start ?? months[0]
  const first = months[0]
  const last = months[months.length - 1]
  const endFor = (start: string) => {
    const i = months.indexOf(start)
    return months[Math.min(months.length - 1, i + years * 12)]
  }
  const [startYm, setStartYm] = useState(() => firstStart)
  const [endYm, setEndYm] = useState(() => endFor(firstStart))
  // 이력이 바뀌어(상품 변경) 고른 달이 없어지면 처음 값으로
  useEffect(() => {
    if (!months.includes(startYm) || !months.includes(endYm)) {
      setStartYm(firstStart)
      setEndYm(endFor(firstStart))
    }
  }, [months]) // eslint-disable-line react-hooks/exhaustive-deps
  const r = useMemo(() => simulatePeriod({ startYm, endYm, monthly, lump, annualDrag: drag, series }), [startYm, endYm, monthly, lump, drag, series])

  const yearsList = Array.from(new Set(months.map((m) => m.slice(0, 4))))
  const monthsOf = (year: string) => months.filter((m) => m.startsWith(year)).map((m) => m.slice(4))
  const pick = (which: 'start' | 'end', year: string, mon: string) => {
    const avail = monthsOf(year)
    const ym = `${year}${avail.includes(mon) ? mon : which === 'start' ? avail[0] : avail[avail.length - 1]}`
    if (which === 'start') setStartYm(ym)
    else setEndYm(ym)
  }
  const ymPicker = (which: 'start' | 'end', value: string) => (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <select aria-label={which === 'start' ? '시작 연도' : '끝 연도'} value={value.slice(0, 4)} onChange={(e) => pick(which, e.target.value, value.slice(4))}>
        {yearsList.map((y) => <option key={y} value={y}>{y}년</option>)}
      </select>
      <select aria-label={which === 'start' ? '시작 월' : '끝 월'} value={value.slice(4)} onChange={(e) => pick(which, value.slice(0, 4), e.target.value)}>
        {monthsOf(value.slice(0, 4)).map((m) => <option key={m} value={m}>{Number(m)}월</option>)}
      </select>
    </span>
  )

  const paidTotal = r ? r.paid[r.months] : 0
  const final = r ? r.value[r.months] : 0
  return (
    <div>
      <div className="acc-period-presets" role="group" aria-label="빠른 선택">
        {presets.map((p) => (
          <button key={p.start} type="button" className={startYm === p.start ? 'is-active' : ''} aria-pressed={startYm === p.start}
            onClick={() => { setStartYm(p.start); setEndYm(endFor(p.start)) }}>{p.label}</button>
        ))}
      </div>
      <div className="acc-period-range">
        <label><span>시작</span>{ymPicker('start', startYm)}</label>
        <label><span>끝</span>{ymPicker('end', endYm)}</label>
      </div>
      {!r ? (
        <p className="acc-warn">끝은 시작보다 뒤여야 합니다. ({ymLabel(first)} ~ {ymLabel(last)} 사이)</p>
      ) : monthly <= 0 && lump <= 0 ? (
        <p className="acc-warn">금액을 입력하세요.</p>
      ) : (
        <>
          <p className="acc-summary">매달 <strong>{man(monthly)}</strong>{lump > 0 ? <> + 처음 {man(lump)}</> : null} · {r.months}개월 ({ymLabel(startYm)} ~ {ymLabel(endYm)})</p>
          <dl className="acc-tiles">
            <div><dt>총 납입</dt><dd>{man(paidTotal)}</dd></div>
            <div className="is-main"><dt>끝 평가금</dt><dd>{man(final)}</dd><small>{paidTotal > 0 ? `${((final / paidTotal - 1) * 100).toFixed(0)}%` : ''}</small></div>
            <div><dt>가장 깊었던 손실</dt><dd>{r.trough ? `${r.trough.pct.toFixed(0)}%` : '없음'}</dd><small>{r.trough ? ymLabel(r.trough.ym) : '원금 아래로 안 내려감'}</small></div>
            <div><dt>원금 회복까지</dt><dd>{!r.trough ? '-' : r.recoveryMonths != null ? `${r.recoveryMonths}개월` : '기간 안에 못 돌아옴'}</dd></div>
          </dl>
          <PeriodChart r={r} />
          <p className="acc-legend"><i className="acc-k-median" />넣은 돈 대비 평가금 (0% = 원금, 붉은 칸은 원금 아래)</p>
          <p className="acc-note">
            {r.peers >= 10
              ? <>이 기간은 같은 길이({r.months}개월)로 시작할 수 있었던 {r.peers}가지 중, 이보다 결과가 나빴던 경우가 <strong>{r.worsePct.toFixed(0)}%</strong>입니다. 한 기간은 우연이 커서 이것만으로 앞날을 판단하지 않습니다.</>
              : <>같은 길이로 시작할 수 있었던 경우가 {r.peers}가지뿐이라 다른 시작점과 비교하지 않습니다.</>}
            {' '}월말 가격 기준이라 실제 매수일 가격과 다르고, 분배금은 고른 상품 기준으로 반영했습니다.
          </p>
        </>
      )}
    </div>
  )
}
