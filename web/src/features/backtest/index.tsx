import React, { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { searchStocks } from '../../lib/stockCache'

type BacktestRiser = {
  code: string
  name?: string
  asof: string
  totalScore: number
  signal: string
  rsi14: number | null
  forwardReturnPct: number
}

type BacktestResponse = {
  params: { horizonBars: number; lookbackDays: number; rallyThresholdPct: number; topN: number }
  baseline: { labelableEvents: number; score70RatePct: number; buySignalRatePct: number }
  riserSummary: { riserEvents: number; avgForwardReturnPct: number }
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

function isBuySignal(signal: string): boolean {
  const u = signal.toUpperCase()
  return ['BUY', 'STRONG_BUY', 'ACCUMULATE', '매수'].some((s) => u.includes(s))
}

function matchMeta(n: number): { label: string; cls: string } {
  if (n >= 3) return { label: '패턴 일치 높음 ★★★', cls: 'bt-match--high' }
  if (n >= 2) return { label: '패턴 일치 중간 ★★', cls: 'bt-match--mid' }
  if (n >= 1) return { label: '패턴 일치 낮음 ★', cls: 'bt-match--low' }
  return { label: '패턴 불일치', cls: 'bt-match--none' }
}

const STEPS = ['종목 수집', '이벤트 탐색', '특징 분석', '결과 계산']
const STEP_THRESHOLDS = [4, 10, 18, 26]
const TOTAL_SECONDS = 30

function BacktestSkeleton() {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const progressPct = Math.min(92, (elapsed / TOTAL_SECONDS) * 100)
  let completedStep = -1
  for (let i = 0; i < STEP_THRESHOLDS.length; i++) {
    if (elapsed >= STEP_THRESHOLDS[i]) completedStep = i
  }
  const activeStep = completedStep + 1 < STEPS.length ? completedStep + 1 : STEPS.length - 1

  return (
    <div className="bt-skeleton">
      <div>
        <div className="bt-skeleton-progress-header">
          <span className="bt-skeleton-step-label">{STEPS[activeStep]}...</span>
          <span className="bt-skeleton-elapsed">{elapsed}초 경과</span>
        </div>
        <div className="bt-skeleton-track">
          <div className="bt-skeleton-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="bt-skeleton-step-names">
          {STEPS.map((s, i) => (
            <span
              key={i}
              className={
                'bt-skeleton-step-name' +
                (i <= completedStep
                  ? ' bt-skeleton-step-name--done'
                  : i === activeStep
                  ? ' bt-skeleton-step-name--active'
                  : '')
              }
            >
              {s}
            </span>
          ))}
        </div>
      </div>
      <hr className="bt-skeleton-divider" />
      <div className="bt-skeleton-summary-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bt-skeleton-summary-item">
            <div className="skeleton" style={{ height: 10, width: '55%' }} />
            <div className="skeleton" style={{ height: 22, width: '70%' }} />
          </div>
        ))}
      </div>
      <div className="bt-skeleton-rows">
        <div className="skeleton" style={{ height: 13 }} />
        <div className="skeleton" style={{ height: 13 }} />
        <div className="skeleton" style={{ height: 13 }} />
        <div className="skeleton" style={{ height: 13, width: '75%' }} />
      </div>
    </div>
  )
}

export default function BacktestPage() {
  const [horizon, setHorizon] = useState<20 | 40 | 60>(20)
  const [lookbackDays, setLookbackDays] = useState(180)
  const [rallyPct, setRallyPct] = useState(20)
  const [topN, setTopN] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<BacktestResponse | null>(null)

  // 종목 패턴 점검
  const [checkSearch, setCheckSearch] = useState('')
  const [checkResults, setCheckResults] = useState<any[]>([])
  const [checkFocused, setCheckFocused] = useState(false)
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null)
  const [scanData, setScanData] = useState<any | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [investAmount, setInvestAmount] = useState(1_000_000)
  const checkDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      const res = await apiFetch(`/api/ui/backtest-risers?${q.toString()}`, {
        cacheMs: 30_000,
        timeoutMs: 30_000,
      })
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

  // 종목 검색 디바운스
  useEffect(() => {
    if (checkDebounceRef.current) clearTimeout(checkDebounceRef.current)
    const q = checkSearch.trim()
    if (q.length < 2) {
      setCheckResults([])
      return
    }
    checkDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchStocks(q, 8)
        setCheckResults(results)
      } catch {
        setCheckResults([])
      }
    }, 150)
  }, [checkSearch])

  const fetchScanData = async (code: string) => {
    setCheckLoading(true)
    setScanData(null)
    try {
      const res = await apiFetch('/api/ui/scan-candidates?limit=200&cacheMs=60000', {
        cacheMs: 60_000,
        timeoutMs: 15_000,
      })
      const candidates = Array.isArray(res?.data) ? res.data : []
      const found = candidates.find((c: any) => String(c.code || '').trim() === code.trim())
      setScanData(found || null)
    } catch {
      setScanData(null)
    } finally {
      setCheckLoading(false)
    }
  }

  const selectStock = (stock: { code: string; name: string }) => {
    setSelectedStock(stock)
    setCheckSearch(stock.name)
    setCheckResults([])
    void fetchScanData(stock.code)
  }

  const patternMatch = useMemo(() => {
    if (!data || !selectedStock) return null
    if (!scanData) {
      return {
        found: false,
        score: null as number | null,
        signal: null as string | null,
        rsi: null as number | null,
        scoreMatch: false,
        buyMatch: false,
        rsiMatch: false,
        matchCount: 0,
      }
    }
    const score = Number(scanData.adaptive_score ?? scanData.total_score ?? scanData.score ?? 0)
    const signal = String(scanData.signal ?? scanData.entry_signal ?? '')
    const rsi = Number(scanData.rsi14 ?? scanData.rsi ?? 0)
    const scoreMatch = score >= 70
    const buyMatch = isBuySignal(signal)
    const rsiMatch = rsi >= 45 && rsi <= 65
    return {
      found: true,
      score,
      signal,
      rsi,
      scoreMatch,
      buyMatch,
      rsiMatch,
      matchCount: [scoreMatch, buyMatch, rsiMatch].filter(Boolean).length,
    }
  }, [data, selectedStock, scanData])

  const investSim = useMemo(() => {
    if (!data || investAmount <= 0) return null
    const avgReturn = data.riserSummary.avgForwardReturnPct
    const gain = investAmount * (avgReturn / 100)
    return { gain, total: investAmount + gain, avgReturn }
  }, [data, investAmount])

  const sorted = useMemo(() => {
    return (data?.risers ?? []).slice().sort((a, b) => b.forwardReturnPct - a.forwardReturnPct)
  }, [data])

  const showCheckDropdown =
    checkFocused && checkSearch.trim().length >= 2 && checkResults.length > 0

  return (
    <div className="bt-page">
      {/* 헤더 */}
      <div className="bt-header">
        <div>
          <h1 className="bt-title">급등 종목 역추적 백테스트</h1>
          <p className="bt-desc">
            최근 크게 오른 종목을 자동 추출한 뒤, 상승 전 공통 특징(점수/시그널/RSI)을 검증합니다.
          </p>
        </div>
        <button className="sim-btn sim-btn--primary" onClick={load} disabled={loading}>
          다시 실행
        </button>
      </div>

      {/* 파라미터 */}
      <div className="bt-params-card">
        <div className="bt-params-grid">
          <div className="bt-param-group">
            <span className="bt-param-label">Horizon</span>
            <div className="bt-horizon-tabs">
              {([20, 40, 60] as const).map((h) => (
                <button
                  key={h}
                  className={`bt-horizon-tab${horizon === h ? ' bt-horizon-tab--active' : ''}`}
                  onClick={() => setHorizon(h)}
                >
                  {h}일
                </button>
              ))}
            </div>
          </div>
          <div className="bt-param-group">
            <span className="bt-param-label">탐색 기간(일)</span>
            <div className="sim-input-row">
              <input
                className="sim-input"
                type="number"
                min={60}
                max={720}
                value={lookbackDays}
                onChange={(e) =>
                  setLookbackDays(Math.max(60, Math.min(720, Number(e.target.value) || 60)))
                }
              />
              <span className="sim-input-suffix">일</span>
            </div>
          </div>
          <div className="bt-param-group">
            <span className="bt-param-label">급등 기준(%)</span>
            <div className="sim-input-row">
              <input
                className="sim-input"
                type="number"
                min={5}
                max={80}
                value={rallyPct}
                onChange={(e) =>
                  setRallyPct(Math.max(5, Math.min(80, Number(e.target.value) || 5)))
                }
              />
              <span className="sim-input-suffix">%</span>
            </div>
          </div>
          <div className="bt-param-group">
            <span className="bt-param-label">표본 수(top N)</span>
            <div className="sim-input-row">
              <input
                className="sim-input"
                type="number"
                min={5}
                max={100}
                value={topN}
                onChange={(e) =>
                  setTopN(Math.max(5, Math.min(100, Number(e.target.value) || 5)))
                }
              />
            </div>
          </div>
        </div>
      </div>

      {loading && <BacktestSkeleton />}
      {!loading && error && (
        <div className="bt-section" style={{ color: 'var(--color-error)' }}>{error}</div>
      )}

      {!loading && !error && data && (
        <>
          {/* 요약 통계 그리드 */}
          <div className="bt-summary-card">
            <div className="bt-summary-grid">
              <div className="bt-summary-item">
                <span className="bt-summary-label">라벨 가능 이벤트</span>
                <span className="bt-summary-value">
                  {data.baseline.labelableEvents.toLocaleString('ko-KR')}건
                </span>
              </div>
              <div className="bt-summary-item">
                <span className="bt-summary-label">급등 이벤트</span>
                <span className="bt-summary-value">
                  {data.riserSummary.riserEvents.toLocaleString('ko-KR')}건
                </span>
              </div>
              <div className="bt-summary-item">
                <span className="bt-summary-label">급등 평균 수익률</span>
                <span className="bt-summary-value" style={{ color: 'var(--color-success)' }}>
                  +{pct(data.riserSummary.avgForwardReturnPct, 2)}
                </span>
              </div>
              <div className="bt-summary-item">
                <span className="bt-summary-label">score≥70 비중(Lift)</span>
                <span className="bt-summary-value">
                  {pct(data.commonFeatures.score70RatePct)}
                  <span className="bt-summary-lift">
                    {' '}({data.commonFeatures.score70LiftPct >= 0 ? '+' : ''}
                    {pct(data.commonFeatures.score70LiftPct)})
                  </span>
                </span>
              </div>
              <div className="bt-summary-item">
                <span className="bt-summary-label">BUY계열 비중(Lift)</span>
                <span className="bt-summary-value">
                  {pct(data.commonFeatures.buySignalRatePct)}
                  <span className="bt-summary-lift">
                    {' '}({data.commonFeatures.buySignalLiftPct >= 0 ? '+' : ''}
                    {pct(data.commonFeatures.buySignalLiftPct)})
                  </span>
                </span>
              </div>
              <div className="bt-summary-item">
                <span className="bt-summary-label">RSI 45~65 비중 (매집 구간)</span>
                <span className="bt-summary-value">
                  {pct(data.commonFeatures.rsi45to65RatePct)}
                </span>
              </div>
            </div>
          </div>

          {/* 종목 패턴 점검 */}
          <div className="bt-section">
            <div className="bt-section-title">종목 패턴 점검</div>
            <p className="bt-check-guide">
              스캔·하이라이트에 등장한 종목을 입력하면 위 역추적에서 발견한 급등 전 패턴과 얼마나
              일치하는지 확인하고, 투자 금액 대비 예상 수익을 계산합니다.
              <br />
              조건이 많이 맞을수록 과거 급등 전 상황과 유사한 것으로 볼 수 있습니다.
            </p>

            <div className="bt-check-search-wrap">
              <div className="sim-add-input-row">
                <input
                  className="sim-add-input"
                  placeholder="스캔/하이라이트에서 발견한 종목명 또는 코드..."
                  value={checkSearch}
                  onChange={(e) => {
                    setCheckSearch(e.target.value)
                    setSelectedStock(null)
                    setScanData(null)
                  }}
                  onFocus={() => setCheckFocused(true)}
                  onBlur={() => setTimeout(() => setCheckFocused(false), 150)}
                />
                {checkSearch && (
                  <button
                    className="sim-add-clear"
                    onClick={() => {
                      setCheckSearch('')
                      setSelectedStock(null)
                      setScanData(null)
                      setCheckResults([])
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              {showCheckDropdown && (
                <div className="sim-add-dropdown">
                  {checkResults.slice(0, 6).map((s: any) => (
                    <button
                      key={s.code}
                      className="sim-add-result"
                      onClick={() =>
                        selectStock({ code: String(s.code), name: String(s.name ?? s.code) })
                      }
                    >
                      <span className="sim-add-result-name">{s.name ?? s.code}</span>
                      <span className="sim-add-result-code">{s.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedStock && (
              <div className="bt-check-result">
                <div className="bt-check-stock-head">
                  <span className="bt-check-stock-name">{selectedStock.name}</span>
                  <span className="bt-check-stock-code">{selectedStock.code}</span>
                  {checkLoading && <span className="bt-check-loading">분석 중...</span>}
                </div>

                {!checkLoading && patternMatch && (
                  <>
                    {!patternMatch.found ? (
                      <div className="bt-check-not-found">
                        현재 스캔 목록에 없는 종목입니다. 이 종목이 스캔·하이라이트에 등장하면
                        다시 확인해 보세요.
                        <br />
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                          아래 투자 시뮬레이션은 역추적 평균 수익률 기준입니다.
                        </span>
                      </div>
                    ) : (
                      <div className="bt-check-criteria">
                        <div
                          className={`bt-check-criterion ${
                            patternMatch.scoreMatch
                              ? 'bt-check-criterion--match'
                              : 'bt-check-criterion--miss'
                          }`}
                        >
                          <span className="bt-check-criterion-icon">
                            {patternMatch.scoreMatch ? '✅' : '❌'}
                          </span>
                          <div className="bt-check-criterion-info">
                            <span className="bt-check-criterion-label">점수 ≥ 70</span>
                            <span className="bt-check-criterion-current">
                              현재 점수 {patternMatch.score}
                            </span>
                          </div>
                          <span className="bt-check-criterion-stat">
                            급등 전 {pct(data.commonFeatures.score70RatePct)}가 해당
                          </span>
                        </div>
                        <div
                          className={`bt-check-criterion ${
                            patternMatch.buyMatch
                              ? 'bt-check-criterion--match'
                              : 'bt-check-criterion--miss'
                          }`}
                        >
                          <span className="bt-check-criterion-icon">
                            {patternMatch.buyMatch ? '✅' : '❌'}
                          </span>
                          <div className="bt-check-criterion-info">
                            <span className="bt-check-criterion-label">BUY계열 시그널</span>
                            <span className="bt-check-criterion-current">
                              현재 {patternMatch.signal || '-'}
                            </span>
                          </div>
                          <span className="bt-check-criterion-stat">
                            급등 전 {pct(data.commonFeatures.buySignalRatePct)}가 해당
                          </span>
                        </div>
                        <div
                          className={`bt-check-criterion ${
                            patternMatch.rsiMatch
                              ? 'bt-check-criterion--match'
                              : 'bt-check-criterion--miss'
                          }`}
                        >
                          <span className="bt-check-criterion-icon">
                            {patternMatch.rsiMatch ? '✅' : '❌'}
                          </span>
                          <div className="bt-check-criterion-info">
                            <span className="bt-check-criterion-label">RSI 45~65 (매집 구간)</span>
                            <span className="bt-check-criterion-current">
                              현재 RSI{' '}
                              {patternMatch.rsi ? patternMatch.rsi.toFixed(1) : '-'}
                            </span>
                          </div>
                          <span className="bt-check-criterion-stat">
                            급등 전 {pct(data.commonFeatures.rsi45to65RatePct)}가 해당
                          </span>
                        </div>
                        <div className="bt-check-match-summary">
                          <span className="bt-check-match-count">
                            {patternMatch.matchCount}/3 조건 충족
                          </span>
                          <span
                            className={`bt-check-match-badge ${
                              matchMeta(patternMatch.matchCount).cls
                            }`}
                          >
                            {matchMeta(patternMatch.matchCount).label}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 투자 시뮬레이션 */}
                    <div className="bt-check-invest">
                      <p className="bt-check-invest-title">투자 시뮬레이션 (역추적 평균 수익률 기준)</p>
                      <div className="bt-check-invest-row">
                        <div className="sim-input-row" style={{ maxWidth: 200 }}>
                          <input
                            className="sim-input"
                            type="number"
                            min={0}
                            step={100_000}
                            value={investAmount}
                            onChange={(e) =>
                              setInvestAmount(Math.max(0, Number(e.target.value || 0)))
                            }
                          />
                          <span className="sim-input-suffix">원</span>
                        </div>
                        {investSim && (
                          <div className="bt-check-invest-result">
                            <span className="bt-check-invest-desc">
                              평균 수익률{' '}
                              <strong>+{pct(investSim.avgReturn, 2)}</strong> ({horizon}일 후 기준)
                            </span>
                            <span className="bt-check-invest-gain">
                              +{investSim.gain.toLocaleString('ko-KR')}원 예상
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="bt-check-invest-note">
                        ※ 과거 급등 이벤트의 평균 수익률을 기준으로 한 추정값입니다. 패턴 일치도가
                        높을수록, 스캔·하이라이트에 함께 등장할수록 신뢰도가 높아집니다.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 급등 이벤트 샘플 테이블 */}
          <div className="bt-section">
            <div className="bt-section-title">급등 이벤트 샘플</div>
            {sorted.length === 0 ? (
              <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                조건에 맞는 급등 이벤트가 없습니다. 기간/기준을 완화해 보세요.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th>종목</th>
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
                        <td>
                          <span style={{ fontWeight: 600 }}>{row.name || row.code}</span>
                          {row.name && (
                            <span
                              style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--color-text-tertiary)',
                                marginLeft: 4,
                              }}
                            >
                              {row.code}
                            </span>
                          )}
                        </td>
                        <td>{row.asof}</td>
                        <td
                          style={{
                            color:
                              row.forwardReturnPct >= 0
                                ? 'var(--color-success)'
                                : 'var(--color-error)',
                            fontWeight: 600,
                          }}
                        >
                          {row.forwardReturnPct > 0 ? '+' : ''}
                          {pct(row.forwardReturnPct, 2)}
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
