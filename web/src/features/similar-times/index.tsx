import { useEffect, useMemo, useState } from 'react'
import More from '../../components/ui/More'
import Skeleton from '../../components/Skeleton'
import { ErrorState } from '../../components/StateViews'
import { apiFetch } from '../../lib/api'
import {
  HORIZONS, INDEPENDENT_GAP_DAYS, NEIGHBORS, SIMILAR, findSimilar, signedPct, similarTimesStale, stateView, ymLabel,
  type NowState, type SimilarResult,
} from '../../lib/similarTimes'

const CARD: React.CSSProperties = { margin: '0 0 var(--space-3, 12px)', padding: '12px 14px', border: '1px solid var(--color-border-default)', borderRadius: 8, lineHeight: 1.55, wordBreak: 'keep-all' }

function Gauge({ score }: { score: number }) {
  return (
    <div aria-label={`심리 점수 ${score.toFixed(0)}점`} style={{ position: 'relative', height: 10, borderRadius: 5, background: 'var(--color-bg-secondary)', margin: '6px 0 2px' }}>
      <div style={{ position: 'absolute', left: `${Math.min(100, Math.max(0, score))}%`, top: -3, width: 4, height: 16, borderRadius: 2, background: 'var(--color-text-primary)', transform: 'translateX(-2px)' }} />
    </div>
  )
}

/** 사례별 선 색(구분용 — 색 자체에 좋고 나쁨의 뜻은 없다). 가까운 순서대로 배정 */
const CASE_COLORS = ['#e15759', '#4e79a7', '#f28e2b', '#59a14f', '#b07aa1', '#17becf', '#edc948', '#ff9da7', '#9c755f', '#76b7b2']

/** 비슷했던 때 이후 6개월 가격 경로를 지금 시점(0)에서 겹쳐 그린다 — 평소 범위(회색 띠)와 사례별 범례 */
function PathChart({ result }: { result: SimilarResult }) {
  const [hover, setHover] = useState<string | null>(null)
  const W = 420
  const H = 220
  const padL = 36
  const padR = 8
  const padT = 8
  const padB = 22
  const steps = SIMILAR.baseline.path.median.length
  // 세로 범위는 실제로 그리는 선(평소 띠·중앙값·사례 10건)만으로 잡는다 — 그리지 않는 사례가 범위를 늘려 선이 가운데로 몰리지 않게
  const drawn = result.cases.slice(0, 10)
  const all = [
    ...SIMILAR.baseline.path.p10, ...SIMILAR.baseline.path.p90, ...result.medianPath, 0,
    ...drawn.flatMap((c) => c.path),
  ]
  const lo = Math.floor(Math.min(...all) / 10) * 10
  const hi = Math.ceil(Math.max(...all) / 10) * 10
  const gridStep = hi - lo <= 100 ? 20 : 40
  const x = (i: number) => padL + (i / steps) * (W - padL - padR)
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  const line = (a: number[]) => [`M${x(0)},${y(0)}`, ...a.map((v, i) => `L${x(i + 1)},${y(v)}`)].join(' ')
  const band = [
    `M${x(0)},${y(0)}`,
    ...SIMILAR.baseline.path.p90.map((v, i) => `L${x(i + 1)},${y(v)}`),
    ...[...SIMILAR.baseline.path.p10].reverse().map((v, i) => `L${x(steps - i)},${y(v)}`),
    'Z',
  ].join(' ')
  const ticks = Array.from(new Set([lo, hi, 0, ...Array.from({ length: Math.floor((hi - lo) / gridStep) + 1 }, (_, i) => lo + i * gridStep).filter((v) => v >= lo && v <= hi)]))
  return (
    <div>
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: 640, height: 'auto' }} role="img"
      aria-label={`비슷했던 때 ${result.independent}번의 이후 6개월 가격 경로와 중앙값, 평소 범위`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--color-border-default)', strokeDasharray: t === 0 ? undefined : '2 3' }} />
          <text x={padL - 4} y={y(t) + 3} textAnchor="end" style={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }}>{t > 0 ? `+${t}` : t}%</text>
        </g>
      ))}
      <path d={band} style={{ fill: 'var(--color-text-tertiary)', fillOpacity: 0.15 }} />
      <path d={line(SIMILAR.baseline.path.median)} style={{ fill: 'none', stroke: 'var(--color-text-tertiary)', strokeWidth: 1.2, strokeDasharray: '4 3' }} />
      {drawn.map((c, i) => (
        <path key={c.date} d={line(c.path)} onMouseEnter={() => setHover(c.date)} onMouseLeave={() => setHover(null)}
          style={{ fill: 'none', stroke: CASE_COLORS[i % CASE_COLORS.length], strokeOpacity: hover == null ? 0.85 : hover === c.date ? 1 : 0.15, strokeWidth: hover === c.date ? 2.6 : 1.4 }}>
          <title>{`${ymLabel(c.date)} → 6개월 뒤 ${signedPct(c.path[c.path.length - 1])}`}</title>
        </path>
      ))}
      <path d={line(result.medianPath)} style={{ fill: 'none', stroke: 'var(--color-text-primary)', strokeWidth: 2.8, strokeOpacity: hover == null ? 1 : 0.35 }} />
      {HORIZONS.map((h) => (
        <text key={h.days} x={x((h.idx + 1))} y={H - 8} textAnchor={h.idx === 23 ? 'end' : 'middle'} style={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }}>{h.label.replace(' 뒤', '')}</text>
      ))}
      <text x={x(0)} y={H - 8} textAnchor="start" style={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }}>지금</text>
    </svg>
    <ul aria-label="사례별 선 색" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12 }}>
      <li style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 16, height: 3, borderRadius: 2, background: 'var(--color-text-primary)' }} /> 중앙값(굵은 선)
      </li>
      {drawn.map((c, i) => (
        <li key={c.date} onMouseEnter={() => setHover(c.date)} onMouseLeave={() => setHover(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'default', opacity: hover == null || hover === c.date ? 1 : 0.4 }}>
          <span style={{ width: 16, height: 3, borderRadius: 2, background: CASE_COLORS[i % CASE_COLORS.length] }} />
          {ymLabel(c.date)} <span className="caption muted">→ {signedPct(c.path[c.path.length - 1], 0)}</span>
        </li>
      ))}
    </ul>
    <div className="caption muted" style={{ marginTop: 2 }}>색은 사례를 구분하는 용도예요. 사례 옆 숫자는 6개월 뒤 수익률이고, 가까운 순서로 나열했어요.</div>
    </div>
  )
}

/** 시장 공부 > 지금과 비슷했던 때 — 예측이 아니라 지금 코스피 상태와 비슷했던 과거의 이후 흐름을 겹쳐 본다 */
export default function SimilarTimesPage() {
  const [now, setNow] = useState<NowState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/ui/similar-times', { cacheMs: 60_000, timeoutMs: 25_000, retries: 1 })
      if (res?.data) setNow(res.data as NowState)
      else setError('지금 코스피 상태를 계산하지 못했어요. 잠시 뒤 다시 열어 보세요.')
    } catch (e: any) {
      setError(e?.message || '불러오지 못했어요.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const result = useMemo(() => (now ? findSimilar(now) : null), [now])
  const view = useMemo(() => (now ? stateView(now) : null), [now])
  const stale = similarTimesStale()

  return (
    <section className="container-app" style={{ maxWidth: 720 }}>
      <div className="title-md" style={{ marginBottom: 4 }}>지금과 비슷했던 때</div>
      <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.6, wordBreak: 'keep-all' }}>
        지금 코스피 상태와 비슷했던 과거 {NEIGHBORS}번의 뒤 흐름을 겹쳐 봤어요.
        <strong> 앞으로를 맞히는 것이 아니라</strong>, 비슷했던 때 어땠는지 보는 기록이에요. 매매 신호가 아닙니다.
      </p>

      {loading && <Skeleton />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && now && view && result && (
        <>
          <div style={CARD}>
            <div style={{ fontWeight: 700 }}>지금 코스피 <span className="caption muted" style={{ fontWeight: 400 }}>{now.asOf} 종가 기준</span></div>
            <div style={{ margin: '4px 0 6px' }}>{view.headline}</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
              <div><span className="caption muted">심리 점수</span><br /><strong>{now.score.toFixed(0)}점</strong> <span className="caption muted">/ 100</span></div>
              <div><span className="caption muted">60일 고점 대비</span><br /><strong>{signedPct(now.dd60, 1)}</strong></div>
              <div><span className="caption muted">변동성(연율)</span><br /><strong>{now.vol20.toFixed(0)}%</strong> <span className="caption muted">{view.volText}</span></div>
            </div>
            <Gauge score={now.score} />
            <div className="caption muted" style={{ display: 'flex', justifyContent: 'space-between' }}><span>흔들리는 쪽 0</span><span>조용히 오르는 쪽 100</span></div>
          </div>

          <div style={CARD}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>비슷했던 때 이후 6개월 가격 경로</div>
            <div className="caption muted" style={{ marginBottom: 6 }}>
              굵은 검은 선 = 비슷했던 {result.count}번의 중앙값, 색깔 선 = 겹치지 않는 사례 {Math.min(10, result.independent)}건(아래 범례), 회색 띠 = 평소(전체 기간) 범위
            </div>
            <PathChart result={result} />
            <div style={{ fontSize: 13, marginTop: 6 }}>
              비슷했던 주 <strong>{result.count}번</strong> · 서로 겹치지 않는 사례 <strong>{result.independent}건</strong>
              <span className="caption muted"> ({result.cases.slice(0, 6).map((c) => ymLabel(c.date)).join(', ')}{result.cases.length > 6 ? ' …' : ''})</span>
            </div>
            {result.independent < 10 && (
              <div style={{ fontSize: 13, color: 'var(--color-warning)' }}>사례가 적어요. 숫자를 크게 믿지 마세요.</div>
            )}
          </div>

          <div style={CARD}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>이후 수익률 분포</div>
            <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed', fontSize: 12 }}>
              <thead>
                <tr><th style={{ textAlign: 'left' }} /><th>1개월 뒤</th><th>3개월 뒤</th><th>6개월 뒤</th></tr>
              </thead>
              <tbody>
                <tr><td>비슷했던 때 중앙값</td>{result.horizons.map((h) => <td key={h.days} style={{ textAlign: 'center' }}><strong>{signedPct(h.median)}</strong></td>)}</tr>
                <tr><td>나쁜 쪽 10%</td>{result.horizons.map((h) => <td key={h.days} style={{ textAlign: 'center' }}>{signedPct(h.p10)}</td>)}</tr>
                <tr><td>좋은 쪽 10%</td>{result.horizons.map((h) => <td key={h.days} style={{ textAlign: 'center' }}>{signedPct(h.p90)}</td>)}</tr>
                <tr><td>평소 중앙값</td>{result.horizons.map((h) => <td key={h.days} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>{signedPct(h.base.median)}</td>)}</tr>
              </tbody>
            </table>
            <div style={{ fontSize: 13, marginTop: 8 }}>
              3개월 안에 10% 넘게 더 빠진 적: <strong>{result.down10Pct.toFixed(0)}%</strong>
              <span className="caption muted"> (평소 {SIMILAR.baseline.down10Pct.toFixed(0)}%)</span>
            </div>
          </div>

          <More label="한계와 읽는 법">
            <ul style={{ margin: '4px 0 8px', paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
              <li>비슷함은 심리 점수·60일 고점 대비·변동성 세 가지로만 쟀어요. 같은 모습이 반복된다는 보장은 없어요.</li>
              <li>같은 시기의 주가 여러 번 잡히면 한 사례로 세요(서로 {INDEPENDENT_GAP_DAYS}일 이상 떨어진 것만). 사례가 10건보다 적으면 우연일 수 있어요.</li>
              <li>심리 점수가 높은 쪽 극단이 꺾임을 알려 주지 않았어요. 30년 자료에서 점수가 높을 땐 오히려 급락이 드물었고, 낮을 땐 더 잦았어요(검증 2026-10-27). 이 화면은 지금이 조용한 국면인지 흔들리는 국면인지 알려 주는 상태 표시예요.</li>
              <li>코스피 종가만 썼어요. 금리·환율·실적 같은 다른 이유는 반영하지 않아요. 시대마다 시장 구조가 달라요.</li>
            </ul>
          </More>
        </>
      )}

      <div className="caption muted" style={{ fontSize: 10, lineHeight: 1.5, marginTop: 8 }}>
        {SIMILAR.period} 코스피 주 1회 표본 {SIMILAR.sampleCount}개 · 생성일 {SIMILAR.generated} · {SIMILAR.script}
        {stale && ' · ⚠️ 자료를 만든 지 6개월이 넘었어요. 다시 확인이 필요합니다.'}
      </div>
    </section>
  )
}
