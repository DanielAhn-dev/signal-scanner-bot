import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { formatKrwMan } from '../../lib/format'
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

type HealthPoint = { date: string; total: number; distancePp: number; outOfBand: number; satellitePct: number; cashPct: number }
type Health = {
  first: HealthPoint | null
  monthAgo: HealthPoint | null
  now: HealthPoint
  split: { heldDistancePp: number; marketPp: number; minePp: number; text: string } | null
}

/**
 * 계좌 건강 — 리밸런싱 가이드의 점검 기록으로 처음·한 달 전·지금을 나란히 본다. 수익률은 넣지 않는다:
 * 몇 달 단위 수익은 잡음이라 그 숫자로 규칙을 흔들게 된다. 대신 "규칙대로 가고 있는지"만 본다.
 */
function HealthCard() {
  const [state, setState] = useState<{ health: Health | null; satCap: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    apiFetch('/api/ui/income-guide', { cacheMs: 0, timeoutMs: 20_000, retries: 0 })
      .then((res) => {
        if (!active) return
        if (!res?.data) setError(res?.error ?? '불러오지 못했습니다.')
        else setState({ health: res.data.health ?? null, satCap: Number(res.data.settings?.satelliteCapPct) || 10 })
      })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)) })
    return () => { active = false }
  }, [])

  if (error) return <section className="choice-card choice-error" role="alert">계좌 건강을 불러오지 못했습니다: {error}</section>
  if (!state) return <section className="choice-card">계좌 건강 불러오는 중…</section>
  const h = state.health
  if (!h) {
    return (
      <section className="choice-card">
        <h2>계좌 건강</h2>
        <p className="choice-wait">실제 계좌 보유를 넣으면 목표 비중에 맞게 가고 있는지 한 달마다 확인할 수 있습니다. <Link to="/portfolio">보유 넣기</Link></p>
      </section>
    )
  }
  const cols = [
    h.first && { label: `처음 (${shortDate(h.first.date)})`, p: h.first },
    h.monthAgo && { label: `한 달 전 (${shortDate(h.monthAgo.date)})`, p: h.monthAgo },
    { label: '지금', p: h.now },
  ].filter(Boolean) as Array<{ label: string; p: HealthPoint }>
  const base = h.monthAgo ?? h.first
  const diff = base ? h.now.distancePp - base.distancePp : 0
  const summary = !base
    ? '오늘 첫 기록을 남겼습니다. 매달 자동으로 기록되니 다음 달부터 비교됩니다.'
    : Math.abs(diff) < 2
      ? `${h.monthAgo ? '한 달 전' : '처음'}과 비슷합니다. 목표 ±10%p 안이면 할 일이 없습니다.`
      : diff < 0
        ? `${h.monthAgo ? '한 달 전' : '처음'}보다 목표에 ${Math.abs(diff).toFixed(0)}%p 가까워졌습니다.`
        : `${h.monthAgo ? '한 달 전' : '처음'}보다 목표에서 ${diff.toFixed(0)}%p 멀어졌습니다. 리밸런싱 가이드에서 남은 일을 확인하세요.`
  const rows: Array<{ label: string; fmt: (p: HealthPoint) => string; bad?: (p: HealthPoint) => boolean }> = [
    { label: '목표와의 거리', fmt: (p) => `${p.distancePp.toFixed(0)}%p`, bad: (p) => p.outOfBand > 0 },
    { label: '±10%p 넘은 바구니', fmt: (p) => `${p.outOfBand}개`, bad: (p) => p.outOfBand > 0 },
    { label: `위성 비중 (상한 ${state.satCap}%)`, fmt: (p) => `${p.satellitePct.toFixed(0)}%`, bad: (p) => p.satellitePct > state.satCap },
    { label: '현금성 비중', fmt: (p) => `${p.cashPct.toFixed(0)}%` },
    { label: '평가액', fmt: (p) => formatKrwMan(p.total) },
  ]
  return (
    <section className="choice-card" aria-label="계좌 건강">
      <h2>계좌 건강 — 규칙대로 가고 있나요</h2>
      <p className="choice-wait">{summary}</p>
      {h.split && <p className="choice-wait">그 사이 변화: {h.split.text}.</p>}
      <div style={{ overflowX: 'auto' }}>
        <table className="choice-health">
          <thead>
            <tr><th />{cols.map((c) => <th key={c.label}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th>{r.label}</th>
                {cols.map((c) => <td key={c.label} className={r.bad?.(c.p) ? 'is-warn' : ''}>{r.fmt(c.p)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="choice-note">
        목표와의 거리 = 목표 비중에 맞추려면 전체의 몇 %를 옮겨야 하는지. 수익률은 일부러 넣지 않았습니다. 몇 달 수익은 운에 가깝고, 이 표는 규칙을 지켰는지만 봅니다.
        시장 몫은 그때 수량을 지금 가격으로 다시 잰 것이고, 내 몫에는 새로 넣은 돈도 들어갑니다.
        기록은 매달 자동으로 쌓이고, <Link to="/income-guide">리밸런싱 가이드</Link>에서 직접 남길 수도 있습니다.
      </p>
    </section>
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
        한 달에 한 번, 내 계좌가 정한 규칙대로 가고 있는지와 내 선택이 결과를 얼마나 바꿨는지 확인합니다. 아래 방식 전환 비교는 자동매매 방식을 바꾼 날부터 "안 바꿨다면"과 실제를 같은 출발점(100)에서 봅니다.
      </p>

      <HealthCard />

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
