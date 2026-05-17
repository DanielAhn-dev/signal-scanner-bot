import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'

type BacktestRiser = {
  code: string
  asof: string
  totalScore: number
  signal: string
  rsi14: number | null
  forwardReturnPct: number
}

type BacktestResponse = {
  params: {
    horizonBars: number
    lookbackDays: number
    rallyThresholdPct: number
    topN: number
  }
  baseline: {
    labelableEvents: number
    score70RatePct: number
    buySignalRatePct: number
  }
  riserSummary: {
    riserEvents: number
    avgForwardReturnPct: number
  }
  commonFeatures: {
    score70RatePct: number
    score70LiftPct: number
    buySignalRatePct: number
    buySignalLiftPct: number
    rsi45to65RatePct: number
  }
  risers: BacktestRiser[]
}

function pct(value: number | null | undefined, digits = 1): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n.toFixed(digits)}%`
}

export default function BacktestPage() {
  const [horizon, setHorizon] = useState<20 | 40 | 60>(20)
  const [lookbackDays, setLookbackDays] = useState(180)
  const [rallyPct, setRallyPct] = useState(20)
  const [topN, setTopN] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<BacktestResponse | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({
        horizon: String(horizon),
        lookbackDays: String(lookbackDays),
        rallyPct: String(rallyPct),
        topN: String(topN),
      })
      const res = await apiFetch(`/api/ui/backtest-risers?${q.toString()}`, { cacheMs: 30_000, timeoutMs: 30_000 })
      setData((res?.data ?? null) as BacktestResponse | null)
    } catch (e: any) {
      setError(e?.message || String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const sorted = useMemo(() => {
    return (data?.risers ?? []).slice().sort((a, b) => b.forwardReturnPct - a.forwardReturnPct)
  }, [data])

  return (
    <div className="container py-3" style={{ maxWidth: 1200 }}>
      <div className="flex-between mb-3" style={{ alignItems: 'center' }}>
        <div>
          <h1 className="title-xl" style={{ marginBottom: 6 }}>급등 종목 역추적 백테스트</h1>
          <div className="muted">최근 크게 오른 종목을 자동 추출한 뒤, 상승 전 공통 특징(점수/시그널/RSI)을 검증합니다.</div>
        </div>
        <Button onClick={load} disabled={loading}>다시 실행</Button>
      </div>

      <div className="card mb-3">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <div>
            <div className="caption" style={{ marginBottom: 6 }}>Horizon</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[20, 40, 60].map((h) => (
                <button
                  key={h}
                  className={`sector-tab-btn${horizon === h ? ' sector-tab-btn--active' : ''}`}
                  onClick={() => setHorizon(h as 20 | 40 | 60)}
                >
                  {h}일
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="caption" style={{ marginBottom: 6 }}>탐색 기간(일)</div>
            <input type="number" min={60} max={720} value={lookbackDays} onChange={(e) => setLookbackDays(Math.max(60, Math.min(720, Number(e.target.value) || 60)))} />
          </div>
          <div>
            <div className="caption" style={{ marginBottom: 6 }}>급등 기준(%)</div>
            <input type="number" min={5} max={80} value={rallyPct} onChange={(e) => setRallyPct(Math.max(5, Math.min(80, Number(e.target.value) || 5)))} />
          </div>
          <div>
            <div className="caption" style={{ marginBottom: 6 }}>표본 수(top N)</div>
            <input type="number" min={5} max={100} value={topN} onChange={(e) => setTopN(Math.max(5, Math.min(100, Number(e.target.value) || 5)))} />
          </div>
        </div>
      </div>

      {loading && <Skeleton lines={8} height={12} />}
      {!loading && error && <div className="card" style={{ color: 'var(--color-error)' }}>{error}</div>}

      {!loading && !error && data && (
        <>
          <div className="cards-list mb-3">
            <div className="card">
              <div className="caption">라벨 가능 이벤트</div>
              <div className="title-lg">{data.baseline.labelableEvents.toLocaleString('ko-KR')}건</div>
            </div>
            <div className="card">
              <div className="caption">급등 이벤트</div>
              <div className="title-lg">{data.riserSummary.riserEvents.toLocaleString('ko-KR')}건</div>
            </div>
            <div className="card">
              <div className="caption">급등 평균 수익률</div>
              <div className="title-lg">{pct(data.riserSummary.avgForwardReturnPct, 2)}</div>
            </div>
            <div className="card">
              <div className="caption">score≥70 비중(Lift)</div>
              <div className="title-lg">
                {pct(data.commonFeatures.score70RatePct)} ({data.commonFeatures.score70LiftPct >= 0 ? '+' : ''}{pct(data.commonFeatures.score70LiftPct)})
              </div>
            </div>
            <div className="card">
              <div className="caption">BUY계열 비중(Lift)</div>
              <div className="title-lg">
                {pct(data.commonFeatures.buySignalRatePct)} ({data.commonFeatures.buySignalLiftPct >= 0 ? '+' : ''}{pct(data.commonFeatures.buySignalLiftPct)})
              </div>
            </div>
            <div className="card">
              <div className="caption">RSI 45~65 비중</div>
              <div className="title-lg">{pct(data.commonFeatures.rsi45to65RatePct)}</div>
            </div>
          </div>

          <div className="card">
            <div className="title-md" style={{ marginBottom: 10 }}>급등 이벤트 샘플</div>
            {sorted.length === 0 && <div className="muted">조건에 맞는 급등 이벤트가 없습니다. 기간/기준을 완화해 보세요.</div>}
            {sorted.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th>코드</th>
                      <th>기준일</th>
                      <th>Horizon 수익률</th>
                      <th>점수</th>
                      <th>시그널</th>
                      <th>RSI14</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row) => (
                      <tr key={`${row.code}-${row.asof}`}>
                        <td>{row.code}</td>
                        <td>{row.asof}</td>
                        <td style={{ color: row.forwardReturnPct >= 0 ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 600 }}>
                          {row.forwardReturnPct > 0 ? '+' : ''}{pct(row.forwardReturnPct, 2)}
                        </td>
                        <td>{row.totalScore.toFixed(1)}</td>
                        <td>{row.signal || '-'}</td>
                        <td>{row.rsi14 == null ? '-' : row.rsi14.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
