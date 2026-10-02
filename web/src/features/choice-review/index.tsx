import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { readSwitchHistory, type SwitchEvent } from '../../lib/switchHistory'
import { useCurrentClientId } from '../../stores/profileStore'
import SheetHeaderBar from '../../components/SheetHeaderBar'
import './choice-review.css'

type Point = { date: string; actual: number; alt: number | null }
type Review = {
  event: SwitchEvent
  days: number
  ready: boolean
  points: Point[]
  actualPct: number | null
  altPct: number | null
  diffPct: number | null
  note: string
}

const MODE_LABEL: Record<string, string> = { stock: '종목 매매 봇', index_hold: '지수 보유' }
const label = (mode: string) => MODE_LABEL[mode] ?? mode
const pct = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)
const pctPoint = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%p`)
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

/** 두 선을 같은 출발점(100)에서 그린다. 색에만 기대지 않도록 실선·점선으로 구분한다 */
function Chart({ points }: { points: Point[] }) {
  const W = 320
  const H = 150
  const pad = { l: 34, r: 8, t: 8, b: 20 }
  const values = points.flatMap((p) => [p.actual, p.alt]).filter((v): v is number => v != null)
  const lo = Math.min(100, ...values)
  const hi = Math.max(100, ...values)
  const span = Math.max(1, hi - lo)
  const x = (i: number) => pad.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b)
  const line = (pick: (p: Point) => number | null) => {
    let d = ''
    points.forEach((p, i) => {
      const v = pick(p)
      if (v != null) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    })
    return d
  }
  const hasAlt = points.some((p) => p.alt != null)
  return (
    <svg className="choice-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="실제와 안 바꿨다면의 수익 비교 그래프">
      <line x1={pad.l} x2={W - pad.r} y1={y(100)} y2={y(100)} className="choice-chart__base" />
      <text x={pad.l - 4} y={y(100) + 3} textAnchor="end" className="choice-chart__tick">100</text>
      <text x={pad.l - 4} y={y(hi) + 3} textAnchor="end" className="choice-chart__tick">{hi.toFixed(0)}</text>
      <text x={pad.l - 4} y={y(lo) + 3} textAnchor="end" className="choice-chart__tick">{lo.toFixed(0)}</text>
      <text x={pad.l} y={H - 5} className="choice-chart__tick">{shortDate(points[0].date)}</text>
      <text x={W - pad.r} y={H - 5} textAnchor="end" className="choice-chart__tick">{shortDate(points[points.length - 1].date)}</text>
      {hasAlt && <path d={line((p) => p.alt)} className="choice-chart__alt" />}
      <path d={line((p) => p.actual)} className="choice-chart__actual" />
    </svg>
  )
}

export default function ChoiceReviewPage() {
  const clientId = useCurrentClientId()
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const events = useMemo(() => (clientId ? readSwitchHistory() : []), [clientId])

  useEffect(() => {
    if (!clientId || !events.length) { setReviews([]); return }
    let active = true
    apiFetch('/api/ui/choice-review', { method: 'POST', body: JSON.stringify({ events }), cacheMs: 0, timeoutMs: 30_000, retries: 0 })
      .then((res) => { if (active) setReviews(Array.isArray(res?.data) ? res.data : []) })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)) })
    return () => { active = false }
  }, [clientId, events])

  return (
    <main className="choice-page">
      <SheetHeaderBar title="내 선택 돌아보기" />
      <p className="choice-lead">
        자동매매 방식을 바꾼 날부터 "안 바꿨다면"과 실제를 같은 출발점(100)에서 비교합니다. 어느 쪽이 정답이라는 뜻이 아니라, 내 선택이 결과를 얼마나 바꿨는지 확인하는 용도입니다.
      </p>

      {error && <section className="choice-card choice-error" role="alert">불러오지 못했습니다: {error}</section>}
      {!error && reviews === null && <section className="choice-card">불러오는 중…</section>}
      {!error && reviews && reviews.length === 0 && (
        <section className="choice-card">
          아직 비교할 선택이 없습니다. 설정에서 자동매매 방식(종목 매매 봇 ↔ 지수 보유)을 바꾸면 그날부터 기록이 시작됩니다.
        </section>
      )}

      {[...(reviews ?? [])].reverse().map((r) => (
        <section className="choice-card" key={r.event.id} aria-label={`${r.event.date} 선택 비교`}>
          <h2>{r.event.date} · {label(r.event.from)} → {label(r.event.to)}</h2>
          {!r.ready ? (
            <p className="choice-wait">{r.note}</p>
          ) : (
            <>
              <dl className="choice-stats">
                <div><dt>실제 (바꾼 뒤)</dt><dd>{pct(r.actualPct)}</dd></div>
                <div><dt>안 바꿨다면</dt><dd>{pct(r.altPct)}</dd></div>
                <div><dt>차이</dt><dd className={r.diffPct == null ? '' : r.diffPct >= 0 ? 'is-up' : 'is-down'}>{pctPoint(r.diffPct)}</dd></div>
              </dl>
              <Chart points={r.points} />
              <div className="choice-legend">
                <span><i className="choice-legend__actual" /> 실제</span>
                {r.altPct != null && <span><i className="choice-legend__alt" /> 안 바꿨다면</span>}
                <span className="choice-legend__days">{r.days}일 경과</span>
              </div>
              <p className="choice-note">{r.note}</p>
            </>
          )}
        </section>
      ))}
    </main>
  )
}
