import React, { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { searchStocks } from '../../lib/stockCache'
import {
  defaultPlanItem,
  readSimulationPlan,
  saveSimulationPlan,
} from '../simulator/planStore'

const ANALYZE_PENDING_CODE_KEY = 'analyze_pending_code'
const BACKTEST_PENDING_CODE_KEY = 'backtest_pending_code'

function navigateTo(route: string) {
  try {
    window.history.pushState({}, '', `/${route}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch { /* ignore */ }
}

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
  availableHorizons?: number[]
  horizonAvailability?: Record<string, number>
  baseline: { labelableEvents: number; score70RatePct: number; buySignalRatePct: number }
  riserSummary: { riserEvents: number; avgForwardReturnPct: number }
  commonFeatures: {
    score70RatePct: number
    score70LiftPct: number
    buySignalRatePct: number
    buySignalLiftPct: number
    rsi45to65RatePct: number
  }
  featureStats?: Array<{
    key: string
    label: string
    baselineRatePct: number
    riserRatePct: number
    liftPct: number
    supportPct: number
  }>
  ruleCandidates?: Array<{
    key: string
    label: string
    supportPct: number
    liftPct: number
    precisionPct: number
    matchedEvents: number
    riserMatches: number
  }>
  risers: BacktestRiser[]
}

type StockIndicators = {
  code: string
  name: string | null
  market: string | null
  close: number | null
  score_date: string | null
  total_score: number | null
  signal: string | null
  indicator_date: string | null
  rsi14: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  pullback_date: string | null
  entry_grade: string | null
  warn_grade: string | null
  dist_pct: number | null
  per: number | null
  pbr: number | null
  roe: number | null
  debt_ratio: number | null
  market_cap: number | null
}

function pct(value: number | null | undefined, digits = 1): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n.toFixed(digits)}%`
}

function signalCls(signal: string): string {
  const u = signal.toUpperCase()
  if (u.includes('BUY')) return 'bt-table-signal bt-table-signal--buy'
  if (u.includes('SELL')) return 'bt-table-signal bt-table-signal--sell'
  if (u.includes('WATCH')) return 'bt-table-signal bt-table-signal--watch'
  return 'bt-table-signal'
}

function isBuySignal(signal: string | null): boolean {
  if (!signal) return false
  const u = signal.toUpperCase()
  return ['BUY', 'STRONG_BUY', 'ACCUMULATE', '매수'].some((s) => u.includes(s))
}

function matchMeta(n: number): { label: string; cls: string } {
  if (n >= 3) return { label: '패턴 일치 높음 ★★★', cls: 'bt-match--high' }
  if (n >= 2) return { label: '패턴 일치 중간 ★★', cls: 'bt-match--mid' }
  if (n >= 1) return { label: '패턴 일치 낮음 ★', cls: 'bt-match--low' }
  return { label: '패턴 불일치', cls: 'bt-match--none' }
}

function pbrMeta(pbr: number): { note: string; cls: string } {
  if (pbr <= 1.0) return { note: '청산가치 이하 — 강한 저평가', cls: 'bt-check-fund-value--good' }
  if (pbr <= 1.5) return { note: '저평가 구간', cls: 'bt-check-fund-value--good' }
  if (pbr <= 2.5) return { note: '적정 수준', cls: '' }
  return { note: '고평가', cls: 'bt-check-fund-value--warn' }
}

function signedPct(value: number | null | undefined, digits = 1): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

const HORIZONS = [20, 40, 60, 90, 120] as const
const DEFAULT_VISIBLE_HORIZONS = [20, 40, 60] as const
const EXTENDED_HORIZONS = [90, 120] as const
type Horizon = typeof HORIZONS[number]

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
  const [horizon, setHorizon] = useState<Horizon>(20)
  const [lookbackDays, setLookbackDays] = useState(90)
  const [rallyPct, setRallyPct] = useState(20)
  const [topN, setTopN] = useState(30)
  const [loading, setLoading] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<BacktestResponse | null>(null)

  // 종목 패턴 점검
  const [checkSearch, setCheckSearch] = useState('')
  const [checkResults, setCheckResults] = useState<any[]>([])
  const [checkFocused, setCheckFocused] = useState(false)
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null)
  const [indicators, setIndicators] = useState<StockIndicators | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [investAmount, setInvestAmount] = useState(1_000_000)
  const checkDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = async () => {
    setHasRun(true)
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
        timeoutMs: 9_500,
      })
      setData((res?.data ?? null) as BacktestResponse | null)
    } catch (e: any) {
      setError(e?.message || String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  // URL param 또는 sessionStorage로 전달된 종목 자동 로드
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlCode = params.get('code')?.trim()
    let pending: string | null = null
    try {
      pending = sessionStorage.getItem(BACKTEST_PENDING_CODE_KEY)
      if (pending) sessionStorage.removeItem(BACKTEST_PENDING_CODE_KEY)
    } catch { /* ignore */ }
    const initCode = urlCode || pending
    if (!initCode) return

    searchStocks(initCode, 1)
      .then((results) => {
        const name = results[0]?.name || initCode
        selectStock({ code: initCode, name })
      })
      .catch(() => selectStock({ code: initCode, name: initCode }))
  }, [])

  // 종목 검색 디바운스
  useEffect(() => {
    if (checkDebounceRef.current) clearTimeout(checkDebounceRef.current)
    const q = checkSearch.trim()
    if (q.length < 2) { setCheckResults([]); return }
    checkDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchStocks(q, 8)
        setCheckResults(results)
      } catch {
        setCheckResults([])
      }
    }, 150)
  }, [checkSearch])

  const fetchIndicators = async (code: string) => {
    setCheckLoading(true)
    setIndicators(null)
    setCheckError(null)
    try {
      const res = await apiFetch(`/api/ui/stock-indicators?code=${encodeURIComponent(code)}`, {
        cacheMs: 0,
        timeoutMs: 12_000,
      })
      setIndicators((res?.data ?? null) as StockIndicators | null)
    } catch (e: any) {
      setCheckError(e?.message || '지표 조회 실패')
    } finally {
      setCheckLoading(false)
    }
  }

  const selectStock = (stock: { code: string; name: string }) => {
    setSelectedStock(stock)
    setCheckSearch(stock.name)
    setCheckResults([])
    void fetchIndicators(stock.code)
  }

  const goAnalyze = (code: string) => {
    try { sessionStorage.setItem(ANALYZE_PENDING_CODE_KEY, code) } catch { /* ignore */ }
    navigateTo('analyze')
  }

  const goSimulator = (stock: { code: string; name: string }) => {
    const existing = readSimulationPlan()
    const newItem = defaultPlanItem(stock)
    const items = [...(existing?.items ?? []), newItem]
    saveSimulationPlan({
      ...(existing ?? { totalCapital: 10_000_000, notes: '' }),
      createdAt: Date.now(),
      items,
    })
    navigateTo('simulator')
  }

  const patternMatch = useMemo(() => {
    if (!data || !selectedStock || !indicators) return null
    const score = indicators.total_score ?? 0
    const signal = indicators.signal ?? ''
    const rsi = indicators.rsi14 ?? 0
    const scoreMatch = score >= 70
    const buyMatch = isBuySignal(signal)
    const rsiMatch = rsi >= 45 && rsi <= 65
    return {
      score,
      signal,
      rsi,
      scoreMatch,
      buyMatch,
      rsiMatch,
      matchCount: [scoreMatch, buyMatch, rsiMatch].filter(Boolean).length,
      entryGrade: indicators.entry_grade,
      warnGrade: indicators.warn_grade,
      distPct: indicators.dist_pct,
      dataDate: indicators.score_date ?? indicators.indicator_date,
    }
  }, [data, selectedStock, indicators])

  const investSim = useMemo(() => {
    if (!data || investAmount <= 0) return null
    const avgReturn = data.riserSummary.avgForwardReturnPct
    const gain = investAmount * (avgReturn / 100)
    return { gain, avgReturn }
  }, [data, investAmount])

  const sorted = useMemo(() => {
    return (data?.risers ?? []).slice().sort((a, b) => b.forwardReturnPct - a.forwardReturnPct)
  }, [data])

  const showCheckDropdown =
    checkFocused && checkSearch.trim().length >= 2 && checkResults.length > 0

  const visibleHorizons = useMemo(() => {
    const base = new Set<number>(DEFAULT_VISIBLE_HORIZONS)
    const available = new Set<number>((data?.availableHorizons ?? []).map((h) => Number(h)))
    for (const h of EXTENDED_HORIZONS) {
      if (available.has(h)) base.add(h)
    }
    base.add(horizon)
    return HORIZONS.filter((h) => base.has(h))
  }, [data?.availableHorizons, horizon])

  const hasExtendedHorizon = useMemo(() => {
    const available = new Set<number>((data?.availableHorizons ?? []).map((h) => Number(h)))
    return EXTENDED_HORIZONS.some((h) => available.has(h))
  }, [data?.availableHorizons])

  const hasFundamental =
    indicators &&
    (indicators.pbr != null || indicators.per != null ||
     indicators.roe != null || indicators.debt_ratio != null)

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
          {hasRun ? '다시 실행' : '실행'}
        </button>
      </div>

      {/* 파라미터 */}
      <div className="bt-params-card">
        <div className="bt-params-grid">
          <div className="bt-param-group">
            <span className="bt-param-label">Horizon</span>
            <div className="bt-horizon-tabs">
              {visibleHorizons.map((h) => (
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
                max={365}
                value={lookbackDays}
                onChange={(e) =>
                  setLookbackDays(Math.max(60, Math.min(365, Number(e.target.value) || 60)))
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
        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 'var(--space-3) 0 0', lineHeight: 1.5 }}>
          {hasExtendedHorizon
            ? '※ 90일·120일은 데이터가 확인된 경우에만 자동으로 노출됩니다.'
            : '※ 기본 표시 Horizon은 20·40·60일이며, 90·120일은 데이터가 확인되면 자동 표시됩니다.'}
        </p>
      </div>

      {loading && <BacktestSkeleton />}
      {!loading && error && (
        <div className="bt-section" style={{ color: 'var(--color-error)' }}>{error}</div>
      )}

      {!loading && !hasRun && !error && (
        <div className="bt-section" style={{ color: 'var(--color-text-tertiary)' }}>
          파라미터를 설정한 뒤 실행 버튼을 눌러 백테스트를 시작하세요.
        </div>
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

          {/* 공통점 탐색 리포트 */}
          <div className="bt-section">
            <div className="bt-section-title">공통점 탐색 리포트 (Support / Lift / Precision)</div>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 var(--space-3)', lineHeight: 1.55 }}>
              Support는 급등 이벤트 내 해당 특징의 커버리지, Lift는 전체 이벤트 대비 강화 정도,
              Precision은 해당 룰이 잡은 이벤트 중 급등 비율입니다.
            </p>

            {(data.featureStats ?? []).length > 0 ? (
              <div style={{ overflowX: 'auto', margin: '0 calc(-1 * var(--space-4))' }}>
                <table className="bt-table" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th>특징</th>
                      <th style={{ textAlign: 'right' }}>Baseline 비중</th>
                      <th style={{ textAlign: 'right' }}>Riser 비중</th>
                      <th style={{ textAlign: 'right' }}>Lift</th>
                      <th style={{ textAlign: 'right' }}>Support</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.featureStats ?? []).map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td className="bt-table-num" style={{ textAlign: 'right' }}>{pct(row.baselineRatePct)}</td>
                        <td className="bt-table-num" style={{ textAlign: 'right' }}>{pct(row.riserRatePct)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={row.liftPct >= 0 ? 'bt-table-return-pos' : 'bt-table-return-neg'}>
                            {signedPct(row.liftPct)}
                          </span>
                        </td>
                        <td className="bt-table-num" style={{ textAlign: 'right' }}>{pct(row.supportPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                공통점 통계를 계산할 데이터가 부족합니다.
              </p>
            )}

            <div style={{ height: 'var(--space-3)' }} />

            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 8 }}>
              추천 패턴 룰 TOP 5
            </div>
            {(data.ruleCandidates ?? []).length > 0 ? (
              <div style={{ overflowX: 'auto', margin: '0 calc(-1 * var(--space-4))' }}>
                <table className="bt-table" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      <th>룰</th>
                      <th style={{ textAlign: 'right' }}>Support</th>
                      <th style={{ textAlign: 'right' }}>Lift</th>
                      <th style={{ textAlign: 'right' }}>Precision</th>
                      <th style={{ textAlign: 'right' }}>매칭 이벤트</th>
                      <th style={{ textAlign: 'right' }}>급등 매칭</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.ruleCandidates ?? []).map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td className="bt-table-num" style={{ textAlign: 'right' }}>{pct(row.supportPct)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={row.liftPct >= 0 ? 'bt-table-return-pos' : 'bt-table-return-neg'}>
                            {signedPct(row.liftPct)}
                          </span>
                        </td>
                        <td className="bt-table-num" style={{ textAlign: 'right' }}>{pct(row.precisionPct)}</td>
                        <td className="bt-table-num" style={{ textAlign: 'right' }}>{row.matchedEvents.toLocaleString('ko-KR')}</td>
                        <td className="bt-table-num" style={{ textAlign: 'right' }}>{row.riserMatches.toLocaleString('ko-KR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                추천 룰을 계산할 표본이 충분하지 않습니다.
              </p>
            )}
          </div>

          {/* 종목 패턴 점검 */}
          <div className="bt-section">
            <div className="bt-section-title">종목 패턴 점검</div>
            <p className="bt-check-guide">
              스캔·하이라이트에 등장한 종목을 입력하면 위 역추적에서 발견한 급등 전 패턴과 얼마나
              일치하는지 확인하고, 투자 금액 대비 예상 수익을 계산합니다.
              스캔 목록 외 임의 종목도 조회 가능합니다.
            </p>

            <div className="bt-check-search-wrap">
              <div className="sim-add-input-row">
                <input
                  className="sim-add-input"
                  placeholder="종목명 또는 코드 입력..."
                  value={checkSearch}
                  onChange={(e) => {
                    setCheckSearch(e.target.value)
                    setSelectedStock(null)
                    setIndicators(null)
                    setCheckError(null)
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
                      setIndicators(null)
                      setCheckError(null)
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
                  <span className="bt-check-stock-name">
                    {indicators?.name ?? selectedStock.name}
                  </span>
                  <span className="bt-check-stock-code">{selectedStock.code}</span>
                  {indicators?.market && (
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'var(--color-bg-sunken)', padding: '2px 6px', borderRadius: 4 }}>
                      {indicators.market}
                    </span>
                  )}
                  {checkLoading && <span className="bt-check-loading">지표 조회 중...</span>}
                </div>

                {checkError && (
                  <div className="bt-check-not-found" style={{ color: 'var(--color-error)' }}>
                    {checkError}
                  </div>
                )}

                {!checkLoading && !checkError && indicators && patternMatch && (
                  <>
                    {/* 기준일 + 현재가 헤더 */}
                    {patternMatch.dataDate && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span>기준일: {patternMatch.dataDate}</span>
                        {indicators.close != null && (
                          <span>현재가 {indicators.close.toLocaleString('ko-KR')}원</span>
                        )}
                        {patternMatch.entryGrade && (
                          <span>눌림목 등급 <strong>{patternMatch.entryGrade}</strong></span>
                        )}
                        {patternMatch.warnGrade && patternMatch.warnGrade !== 'SAFE' && (
                          <span style={{ color: 'var(--color-warning)' }}>⚠ 경고 {patternMatch.warnGrade}</span>
                        )}
                      </div>
                    )}

                    {/* 패턴 조건 3가지 */}
                    <div className="bt-check-criteria">
                      <div className={`bt-check-criterion ${patternMatch.scoreMatch ? 'bt-check-criterion--match' : 'bt-check-criterion--miss'}`}>
                        <span className="bt-check-criterion-icon">{patternMatch.scoreMatch ? '✅' : '❌'}</span>
                        <div className="bt-check-criterion-info">
                          <span className="bt-check-criterion-label">점수 ≥ 70</span>
                          <span className="bt-check-criterion-current">현재 점수 {patternMatch.score ?? '-'}</span>
                        </div>
                        <span className="bt-check-criterion-stat">급등 전 {pct(data.commonFeatures.score70RatePct)}가 해당</span>
                      </div>
                      <div className={`bt-check-criterion ${patternMatch.buyMatch ? 'bt-check-criterion--match' : 'bt-check-criterion--miss'}`}>
                        <span className="bt-check-criterion-icon">{patternMatch.buyMatch ? '✅' : '❌'}</span>
                        <div className="bt-check-criterion-info">
                          <span className="bt-check-criterion-label">BUY계열 시그널</span>
                          <span className="bt-check-criterion-current">현재 {patternMatch.signal || '-'}</span>
                        </div>
                        <span className="bt-check-criterion-stat">급등 전 {pct(data.commonFeatures.buySignalRatePct)}가 해당</span>
                      </div>
                      <div className={`bt-check-criterion ${patternMatch.rsiMatch ? 'bt-check-criterion--match' : 'bt-check-criterion--miss'}`}>
                        <span className="bt-check-criterion-icon">{patternMatch.rsiMatch ? '✅' : '❌'}</span>
                        <div className="bt-check-criterion-info">
                          <span className="bt-check-criterion-label">RSI 45~65 (매집 구간)</span>
                          <span className="bt-check-criterion-current">현재 RSI {patternMatch.rsi ? patternMatch.rsi.toFixed(1) : '-'}</span>
                        </div>
                        <span className="bt-check-criterion-stat">급등 전 {pct(data.commonFeatures.rsi45to65RatePct)}가 해당</span>
                      </div>
                      <div className="bt-check-match-summary">
                        <span className="bt-check-match-count">{patternMatch.matchCount}/3 조건 충족</span>
                        <span className={`bt-check-match-badge ${matchMeta(patternMatch.matchCount).cls}`}>
                          {matchMeta(patternMatch.matchCount).label}
                        </span>
                      </div>
                    </div>

                    {/* 펀더멘털 패널 — 장기 보유 판단용 */}
                    {hasFundamental && (
                      <div className="bt-check-fundamental">
                        <div className="bt-check-fundamental-title">펀더멘털 지표 — 장기 보유 판단용</div>
                        <div className="bt-check-fundamental-grid">
                          {indicators.pbr != null && (() => {
                            const m = pbrMeta(indicators.pbr)
                            return (
                              <div className="bt-check-fund-item">
                                <span className="bt-check-fund-label">PBR</span>
                                <span className={`bt-check-fund-value ${m.cls}`}>{indicators.pbr.toFixed(2)}x</span>
                                <span className="bt-check-fund-note">{m.note}</span>
                              </div>
                            )
                          })()}
                          {indicators.per != null && indicators.per > 0 && (
                            <div className="bt-check-fund-item">
                              <span className="bt-check-fund-label">PER</span>
                              <span className={`bt-check-fund-value ${indicators.per < 10 ? 'bt-check-fund-value--good' : indicators.per > 30 ? 'bt-check-fund-value--warn' : ''}`}>
                                {indicators.per.toFixed(1)}x
                              </span>
                              <span className="bt-check-fund-note">{indicators.per < 10 ? '저PER 저평가' : indicators.per > 30 ? '고PER 주의' : '적정 수준'}</span>
                            </div>
                          )}
                          {indicators.roe != null && (
                            <div className="bt-check-fund-item">
                              <span className="bt-check-fund-label">ROE</span>
                              <span className={`bt-check-fund-value ${indicators.roe >= 15 ? 'bt-check-fund-value--good' : indicators.roe < 5 ? 'bt-check-fund-value--warn' : ''}`}>
                                {indicators.roe.toFixed(1)}%
                              </span>
                              <span className="bt-check-fund-note">{indicators.roe >= 15 ? '우수한 수익성' : indicators.roe < 5 ? '수익성 낮음' : '보통'}</span>
                            </div>
                          )}
                          {indicators.debt_ratio != null && (
                            <div className="bt-check-fund-item">
                              <span className="bt-check-fund-label">부채비율</span>
                              <span className={`bt-check-fund-value ${indicators.debt_ratio > 200 ? 'bt-check-fund-value--bad' : indicators.debt_ratio < 100 ? 'bt-check-fund-value--good' : ''}`}>
                                {indicators.debt_ratio.toFixed(0)}%
                              </span>
                              <span className="bt-check-fund-note">{indicators.debt_ratio > 200 ? '고부채 위험' : indicators.debt_ratio < 100 ? '재무 건전' : '보통'}</span>
                            </div>
                          )}
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
                              평균 수익률 <strong>+{pct(investSim.avgReturn, 2)}</strong> ({horizon}일 후 기준)
                            </span>
                            <span className="bt-check-invest-gain">
                              +{investSim.gain.toLocaleString('ko-KR')}원 예상
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="bt-check-invest-note">
                        ※ 과거 급등 이벤트의 평균 수익률 기준 추정값입니다. 패턴 일치도가 높을수록, 스캔·하이라이트에 함께 등장할수록 신뢰도가 높아집니다.
                      </p>
                    </div>

                    {/* 다음 단계 액션 */}
                    <div className="bt-check-actions">
                      <button
                        className="sim-btn sim-btn--ghost"
                        onClick={() => goAnalyze(selectedStock.code)}
                      >
                        📈 상세 분석 보기
                      </button>
                      <button
                        className="sim-btn sim-btn--primary"
                        onClick={() => goSimulator(selectedStock)}
                      >
                        ➕ 시뮬레이터에 추가
                      </button>
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
              <div style={{ overflowX: 'auto', margin: '0 calc(-1 * var(--space-4))' }}>
                <table className="bt-table" style={{ minWidth: 680 }}>
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th>기준일</th>
                      <th style={{ textAlign: 'right' }}>Horizon 수익률</th>
                      <th style={{ textAlign: 'right' }}>점수</th>
                      <th>시그널</th>
                      <th style={{ textAlign: 'right' }}>RSI14</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row) => (
                      <tr
                        key={`${row.code}-${row.asof}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() =>
                          selectStock({ code: row.code, name: row.name || row.code })
                        }
                        title={`${row.name || row.code} 패턴 점검`}
                      >
                        <td>
                          <span className="bt-table-stock-name">{row.name || row.code}</span>
                          {row.name && (
                            <span className="bt-table-stock-code">{row.code}</span>
                          )}
                        </td>
                        <td className="bt-table-num">{row.asof}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={row.forwardReturnPct >= 0 ? 'bt-table-return-pos' : 'bt-table-return-neg'}>
                            {row.forwardReturnPct > 0 ? '+' : ''}
                            {pct(row.forwardReturnPct, 2)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="bt-table-num">
                          {row.totalScore.toFixed(1)}
                        </td>
                        <td>
                          {row.signal ? (
                            <span className={signalCls(row.signal)}>{row.signal}</span>
                          ) : (
                            <span className="bt-table-num">-</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className="bt-table-num">
                          {row.rsi14 == null ? '-' : row.rsi14.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 'var(--space-3) 0 0' }}>
              종목 클릭 시 위 패턴 점검에 자동 입력됩니다.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
