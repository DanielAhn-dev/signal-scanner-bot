import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { searchStocks } from '../../lib/stockCache'
import {
  defaultPlanItem,
  readSimulationPlan,
  saveSimulationPlan,
} from '../simulator/planStore'
import type {
  AutoPickItem,
  AutoPickTier,
  BacktestResponse,
  ReturnProfileKey,
  ScanCandidateLite,
  StockIndicators,
} from './types'
import {
  ANALYZE_PENDING_CODE_KEY,
  BACKTEST_PENDING_CODE_KEY,
  EXECUTION_GUIDE_PENDING_KEY,
  type Horizon,
} from './constants'
import { toEokFromWon } from './lib/format'
import { bucketAutoPicks, estimateExpectedReturnPct, evaluateAutoPick } from './lib/autoPick'
import {
  computeInvestSim,
  computeVisibleHorizons,
  filterFeatureStats,
  hasExtendedHorizon as hasExtendedHorizonData,
  sortRisers,
} from './lib/backtestView'
import { buildPatternMatch } from './lib/patternMatch'
import BacktestSkeleton from './components/BacktestSkeleton'
import ParamsCard from './components/ParamsCard'
import SummaryTab from './components/SummaryTab'
import CheckTab from './components/CheckTab'
import SamplesTab from './components/SamplesTab'
import { filterSamplesByRule, isRuleKeyMatched, matchesRuleFilter } from './lib/ruleMatch'
import { isBuySignal } from './lib/signal'

function navigateTo(route: string) {
  try {
    window.history.pushState({}, '', `/${route}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch { /* ignore */ }
}

export default function BacktestPage() {
  const [horizon, setHorizon] = useState<Horizon>(20)
  const [lookbackDays, setLookbackDays] = useState(120)
  const [rallyPct, setRallyPct] = useState(20)
  const [topN, setTopN] = useState(30)
  const [loading, setLoading] = useState(false)
  const [hasRun, setHasRun] = useState(false) // auto-run 후 재실행 여부 추적용
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<BacktestResponse | null>(null)
  const [selectedRuleKey, setSelectedRuleKey] = useState<string | null>(null)
  const [showAllFeatureRows, setShowAllFeatureRows] = useState(false)
  const [activeTab, setActiveTab] = useState<'summary' | 'check' | 'samples'>('summary')
  const [sortKey, setSortKey] = useState<'forwardReturnPct' | 'totalScore' | 'rsi14' | 'asof'>('forwardReturnPct')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // 종목 패턴 점검
  const [checkSearch, setCheckSearch] = useState('')
  const [checkResults, setCheckResults] = useState<any[]>([])
  const [checkFocused, setCheckFocused] = useState(false)
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null)
  const [indicators, setIndicators] = useState<StockIndicators | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [autoPickLoading, setAutoPickLoading] = useState(false)
  const [autoPickError, setAutoPickError] = useState<string | null>(null)
  const [autoPicks, setAutoPicks] = useState<AutoPickItem[]>([])
  const [conditionStats, setConditionStats] = useState({
    buySignalPct: 0,
    score50PlusPct: 0,
    rsi45_65Pct: 0,
    totalScanned: 0,
  })
  const [returnProfile, setReturnProfile] = useState<ReturnProfileKey>('strict')
  // 기대수익 = 규칙 일치 과거 사례 평균(모든 후보 동일). 0이면 과거 평균이 플러스인 규칙만 통과.
  const [minExpectedReturnPct, setMinExpectedReturnPct] = useState(0)
  const [minShortMomentumPct, setMinShortMomentumPct] = useState(-2)
  const [minLiquidityEok, setMinLiquidityEok] = useState(50)
  const [investAmount, setInvestAmount] = useState(1_000_000)
  const checkDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkWrapRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    setHasRun(true)
    setLoading(true)
    setError(null)
    try {
      const requestTs = Date.now()
      const q = new URLSearchParams({
        horizon: String(horizon),
        lookbackDays: String(lookbackDays),
        rallyPct: String(rallyPct),
        topN: String(topN),
      })
      q.set('_ts', String(requestTs))
      const res = await apiFetch(`/api/ui/backtest-risers?${q.toString()}`, {
        cacheMs: 0,
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
    const candidates = data?.ruleCandidates ?? []
    if (candidates.length === 0) return

    setSelectedRuleKey((current) => {
      if (current && candidates.some((rule) => rule.key === current)) return current
      return candidates[0].key
    })
  }, [data])

  useEffect(() => {
    const selectedRule = (data?.ruleCandidates ?? []).find((rule) => rule.key === selectedRuleKey)
      ?? (data?.ruleCandidates ?? [])[0]
    if (!data || !selectedRule) {
      setAutoPicks([])
      setAutoPickError(null)
      setAutoPickLoading(false)
      return
    }

    let disposed = false
    const run = async () => {
      setAutoPickLoading(true)
      setAutoPickError(null)
      try {
        const scanRes = await apiFetch('/api/ui/scan-candidates?limit=60&includeIndicatorLiquidity=1&cacheMs=0', {
          cacheMs: 0,
          timeoutMs: 12_000,
        })
        const candidates = Array.isArray(scanRes?.data)
          ? (scanRes.data as ScanCandidateLite[]).filter((row) => !!row?.code)
          : []
        const candidateMap = new Map(
          candidates.map((row) => [String(row.code || '').trim(), row]),
        )

        console.log(`[Auto-Pick] 스캔 후보: ${candidates.length}개`)

        if (candidates.length === 0) {
          if (!disposed) setAutoPicks([])
          return
        }

        // 스캔 후보 신호/점수 분포 확인
        const signalStats: Record<string, number> = {}
        const scoreBySignal: Record<string, number[]> = {}
        candidates.slice(0, 36).forEach((c) => {
          const sig = String(c.name || 'unknown')
          signalStats[sig] = (signalStats[sig] || 0) + 1
        })

        let evaluatedCount = 0
        let ruleFilteredCount = 0
        let returnFilteredCount = 0
        let momentumFilteredCount = 0
        let liquidityFilteredCount = 0
        let buySignalCount = 0
        let score50PlusCount = 0
        let rsi45_65Count = 0

        const scanSlice = candidates.slice(0, 36)
        const settled = await Promise.allSettled(
          scanSlice.map(async (candidate) => {
            const code = String(candidate.code || '').trim()
            if (!code) return null
            const indicatorRes = await apiFetch(`/api/ui/stock-indicators?code=${encodeURIComponent(code)}`, {
              cacheMs: 0,
              timeoutMs: 8_000,
            })
            const indicator = (indicatorRes?.data ?? null) as StockIndicators | null
            if (!indicator) return null
            
            // 조건별 충족 여부 확인
            const score = Number(indicator.total_score ?? 0)
            const rsi = indicator.rsi14
            if (isBuySignal(indicator.signal)) buySignalCount++
            if (score >= 50) score50PlusCount++
            if (rsi != null && rsi >= 45 && rsi <= 65) rsi45_65Count++
            
            const ranked = evaluateAutoPick(indicator)
            if (!ranked) return null
            if (ranked.tier === 'watch') return null
            evaluatedCount++
            
            const ruleMatched = matchesRuleFilter(indicator, selectedRule.filter)
            if (!ruleMatched && ranked.coreMatchCount < 2) {
              ruleFilteredCount++
              return null
            }

            const scan = candidateMap.get(code)
            const intradayChangePct = Number(scan?.intraday_change_pct)
            const inferredMomentum = Number(indicator.roc21 ?? 0) / 4.2
            const shortMomentumPct = Number.isFinite(intradayChangePct) && intradayChangePct !== 0
              ? intradayChangePct
              : inferredMomentum

            const expectedReturnPct = estimateExpectedReturnPct({
              baseReturnPct: Number(
                (ruleMatched ? selectedRule.matchedAvgReturnPct : data.baseline.avgForwardReturnPct) ?? 0,
              ),
              coreMatchCount: ranked.coreMatchCount,
              ruleMatched,
              score: Number(indicator.total_score ?? 0),
              shortMomentumPct,
              tier: ranked.tier,
              profile: returnProfile,
            })

            const liquidity = Number(scan?.liquidity)
            const liquidityWon = Number.isFinite(liquidity) && liquidity > 0 ? liquidity : null
            const liquidityEok = toEokFromWon(liquidityWon)

            if (expectedReturnPct < minExpectedReturnPct) {
              returnFilteredCount++
              return null
            }
            if (shortMomentumPct < minShortMomentumPct) {
              momentumFilteredCount++
              return null
            }
            if (liquidityEok < minLiquidityEok) {
              liquidityFilteredCount++
              return null
            }

            return {
              code,
              name: String(indicator.name || candidate.name || code),
              score: Number(indicator.total_score ?? 0),
              signal: String(indicator.signal || '-'),
              rsi14: indicator.rsi14,
              market: indicator.market,
              warnGrade: indicator.warn_grade,
              ruleMatched,
              coreMatchCount: ranked.coreMatchCount,
              edgeScore: ranked.edgeScore,
              expectedReturnPct,
              shortMomentumPct: Number(shortMomentumPct.toFixed(1)),
              liquidity: liquidityWon,
              tier: ranked.tier,
            } as AutoPickItem
          }),
        )

        const tierRank: Record<AutoPickTier, number> = { now: 3, prepare: 2, watch: 1 }
        const next = settled
          .filter((row): row is PromiseFulfilledResult<AutoPickItem | null> => row.status === 'fulfilled')
          .map((row) => row.value)
          .filter((row): row is AutoPickItem => !!row)
          .sort((a, b) => {
            if (tierRank[b.tier] !== tierRank[a.tier]) return tierRank[b.tier] - tierRank[a.tier]
            if (b.edgeScore !== a.edgeScore) return b.edgeScore - a.edgeScore
            return b.score - a.score
          })
          .slice(0, 12)

        console.log(`[Auto-Pick] 필터 결과:
  - 조건 충족률 (36개 중):
    • BUY 신호: ${buySignalCount}개 (${Math.round(buySignalCount / 36 * 100)}%)
    • 점수 50+: ${score50PlusCount}개 (${Math.round(score50PlusCount / 36 * 100)}%)
    • RSI 45-65: ${rsi45_65Count}개 (${Math.round(rsi45_65Count / 36 * 100)}%)
  - 티어 평가 통과: ${evaluatedCount}개
  - 규칙 필터 제외: ${ruleFilteredCount}개
  - 기대수익 필터 제외: ${returnFilteredCount}개 (최소값: ${minExpectedReturnPct}%)
  - 모멘텀 필터 제외: ${momentumFilteredCount}개 (최소값: ${minShortMomentumPct}%)
  - 거래대금 필터 제외: ${liquidityFilteredCount}개 (최소값: ${minLiquidityEok}억)
  - 최종 추천: ${next.length}개`)

        const scanned = scanSlice.length
        if (!disposed) {
          setConditionStats({
            buySignalPct: scanned > 0 ? Math.round(buySignalCount / scanned * 100) : 0,
            score50PlusPct: scanned > 0 ? Math.round(score50PlusCount / scanned * 100) : 0,
            rsi45_65Pct: scanned > 0 ? Math.round(rsi45_65Count / scanned * 100) : 0,
            totalScanned: scanned,
          })
          setAutoPicks(next)
        }
      } catch (e: any) {
        if (!disposed) {
          setAutoPicks([])
          setAutoPickError(e?.message || '자동 추천 조회 실패')
        }
      } finally {
        if (!disposed) setAutoPickLoading(false)
      }
    }

    void run()
    return () => {
      disposed = true
    }
  }, [data, selectedRuleKey, minExpectedReturnPct, minShortMomentumPct, minLiquidityEok, returnProfile])

  // 최초 마운트 시 자동 실행
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    setActiveTab('check')
  }

  const goAnalyze = (code: string) => {
    try { sessionStorage.setItem(ANALYZE_PENDING_CODE_KEY, code) } catch { /* ignore */ }
    navigateTo('analyze')
  }

  const goExecutionGuide = (code: string) => {
    try {
      sessionStorage.setItem(
        EXECUTION_GUIDE_PENDING_KEY,
        JSON.stringify({ codes: [code], source: 'backtest' }),
      )
    } catch {
      // ignore
    }
    navigateTo('execution-guide')
  }

  const goSimulator = (stock: { code: string; name: string }) => {
    const existing = readSimulationPlan()
    const newItem = defaultPlanItem(stock)
    const items = [...(existing?.items ?? []), newItem]
    saveSimulationPlan({
      ...(existing ?? { totalCapital: 0, notes: '' }), // 0이면 시뮬레이터가 내 시드로 채운다
      createdAt: Date.now(),
      items,
    })
    navigateTo('simulator')
  }

  const addAutoPicksToSimulator = (tiers: AutoPickTier[]) => {
    const targets = autoPicks.filter((row) => tiers.includes(row.tier))
    if (targets.length === 0) return

    const existing = readSimulationPlan()
    const prevItems = existing?.items ?? []
    const codeSet = new Set(prevItems.map((item) => String(item.code || '')))

    const newItems = targets
      .filter((row) => !codeSet.has(row.code))
      .map((row) => defaultPlanItem({ code: row.code, name: row.name }))

    if (newItems.length === 0) {
      navigateTo('simulator')
      return
    }

    saveSimulationPlan({
      ...(existing ?? { totalCapital: 0, notes: '' }), // 0이면 시뮬레이터가 내 시드로 채운다
      createdAt: Date.now(),
      items: [...prevItems, ...newItems],
    })
    navigateTo('simulator')
  }

  const applyReturnProfile = (profile: ReturnProfileKey) => {
    setReturnProfile(profile)
    if (profile === 'strict') {
      setMinExpectedReturnPct(1)
      setMinShortMomentumPct(-2)
      setMinLiquidityEok(50)
      return
    }
    if (profile === 'conservative') {
      setMinExpectedReturnPct(0)
      setMinShortMomentumPct(-5)
      setMinLiquidityEok(30)
      return
    }
    // 공격형: 필터 거의 없음 (기술지표 신호 품질만 봄)
    setMinExpectedReturnPct(-100)
    setMinShortMomentumPct(-10)
    setMinLiquidityEok(10)
  }

  const patternMatch = useMemo(() => {
    if (!data || !selectedStock || !indicators) return null
    return buildPatternMatch(indicators)
  }, [data, selectedStock, indicators])

  const matchedRuleCandidates = useMemo(() => {
    if (!data || !indicators) return [] as Array<{ key: string; label: string; matched: boolean }>
    return (data.ruleCandidates ?? []).map((rule) => ({
      key: rule.key,
      label: rule.label,
      matched: isRuleKeyMatched(rule.key, indicators),
    }))
  }, [data, indicators])

  const selectedStockAutoPick = useMemo(
    () => (!selectedStock ? null : (autoPicks.find((row) => row.code === selectedStock.code) ?? null)),
    [selectedStock, autoPicks],
  )

  const investSim = useMemo(() => {
    if (!data) return null
    return computeInvestSim({
      baselineAvgReturnPct: data.baseline.avgForwardReturnPct,
      investAmount,
      patternReturnPct: selectedStockAutoPick?.expectedReturnPct ?? null,
    })
  }, [data, investAmount, selectedStockAutoPick])

  const sorted = useMemo(() => sortRisers(data?.risers ?? [], sortKey, sortDir), [data, sortKey, sortDir])

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortIcon = (key: typeof sortKey) => {
    const active = sortKey === key
    const icon = active ? (sortDir === 'desc' ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />) : <ArrowUpDown size={12} aria-hidden />
    return <span className={`bt-sort-icon${active ? ' bt-sort-icon--active' : ''}`}>{icon}</span>
  }

  const filteredSamplesByRule = useMemo(() => {
    if (!selectedRuleKey || !data) return []
    const rule = (data.ruleCandidates ?? []).find((r) => r.key === selectedRuleKey)
    if (!rule || !rule.filter) return []
    return filterSamplesByRule(sorted, rule.filter)
  }, [selectedRuleKey, data, sorted])

  const visibleFeatureStats = useMemo(
    () => filterFeatureStats(data?.featureStats ?? [], showAllFeatureRows),
    [data?.featureStats, showAllFeatureRows],
  )

  const hiddenFeatureCount = Math.max(0, (data?.featureStats ?? []).length - visibleFeatureStats.length)

  const showCheckDropdown =
    checkFocused && checkSearch.trim().length >= 2 && checkResults.length > 0

  const visibleHorizons = useMemo(
    () => computeVisibleHorizons(data?.availableHorizons, horizon),
    [data?.availableHorizons, horizon],
  )

  const hasExtendedHorizon = useMemo(
    () => hasExtendedHorizonData(data?.availableHorizons),
    [data?.availableHorizons],
  )

  const hasFundamental =
    indicators &&
    (indicators.pbr != null || indicators.per != null ||
     indicators.roe != null || indicators.debt_ratio != null)

  const autoPickBuckets = useMemo(() => bucketAutoPicks(autoPicks), [autoPicks])

  return (
    <div className="bt-page">
      {/* 헤더 */}
      <div className="bt-header">
        <div>
          <h1 className="bt-title">급등 종목 역추적 백테스트</h1>
          <p className="bt-desc">
            최근 크게 오른 종목을 역추적해 상승 전 공통 패턴(점수·시그널·RSI)을 발굴하고, 현재 종목과 비교합니다.
          </p>
        </div>
        <button className="sim-btn sim-btn--primary" onClick={load} disabled={loading}>
          {loading ? '분석 중...' : '재실행'}
        </button>
      </div>

      {/* 파라미터 */}
      <ParamsCard
        horizon={horizon}
        setHorizon={setHorizon}
        lookbackDays={lookbackDays}
        setLookbackDays={setLookbackDays}
        rallyPct={rallyPct}
        setRallyPct={setRallyPct}
        topN={topN}
        setTopN={setTopN}
        visibleHorizons={visibleHorizons}
        hasExtendedHorizon={hasExtendedHorizon}
      />
      {loading && <BacktestSkeleton />}
      {!loading && error && (
        <div className="bt-section" style={{ color: 'var(--color-error)' }}>{error}</div>
      )}

      {!loading && !error && data && (
        <>
          {/* 디버그 정보 (개발용) */}
          {(data as any)?._debug && (
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-bg-sunken)',
                border: '1px solid var(--color-border-muted)',
                borderRadius: 'var(--radius-xs)',
                fontSize: 11,
                color: 'var(--color-text-tertiary)',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>데이터 파이프라인 진단</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: 10 }}>
                <div>scores 행: {((data as any)._debug.scoreRowsCount || 0).toLocaleString()}개</div>
                <div>unique 종목: {((data as any)._debug.uniqueScoreCodes || 0).toLocaleString()}개</div>
                <div>가격 행: {((data as any)._debug.priceRowsCount || 0).toLocaleString()}개</div>
                <div>가격 인덱스 종목: {((data as any)._debug.priceIndexCodesCount || 0).toLocaleString()}개</div>
                <div>레이블링 가능: {((data as any)._debug.labelableEventsCount || 0).toLocaleString()}개</div>
                <div style={{ fontWeight: 700, color: 'var(--color-text-secondary)' }}>급등 이벤트: {((data as any)._debug.riserUniverseCount || 0).toLocaleString()}개 (기준: {((data as any)._debug.rallyThresholdPct || 20)}%↑)</div>
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--color-warning)' }}>
                0건이 나오면: ① scores 데이터 없음 ② 가격 데이터 부족 ③ {((data as any)._debug.horizonBars || 20)}일치 과거 가격 없음 중 하나입니다.
              </div>
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--color-text-tertiary)', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                params: {JSON.stringify(data.params)}
              </div>
            </div>
          )}

          {/* 탭 바 */}
          <div className="bt-tab-bar">
            <button
              className={`bt-tab${activeTab === 'summary' ? ' bt-tab--active' : ''}`}
              onClick={() => setActiveTab('summary')}
            >
              백테스트 결과
            </button>
            <button
              className={`bt-tab${activeTab === 'check' ? ' bt-tab--active' : ''}`}
              onClick={() => setActiveTab('check')}
            >
              종목 점검
              {selectedStock && (
                <span className="bt-tab-badge">{selectedStock.name}</span>
              )}
            </button>
            <button
              className={`bt-tab${activeTab === 'samples' ? ' bt-tab--active' : ''}`}
              onClick={() => setActiveTab('samples')}
            >
              이벤트 샘플
              {sorted.length > 0 && (
                <span className="bt-tab-badge">{sorted.length}</span>
              )}
            </button>
          </div>

          {/* ── 백테스트 결과 탭: 요약 + 공통 패턴 ── */}
          {activeTab === 'summary' && (
            <SummaryTab
              data={data}
              selectedRuleKey={selectedRuleKey}
              setSelectedRuleKey={setSelectedRuleKey}
              showAllFeatureRows={showAllFeatureRows}
              setShowAllFeatureRows={setShowAllFeatureRows}
              selectStock={selectStock}
              filteredSamplesByRule={filteredSamplesByRule}
              visibleFeatureStats={visibleFeatureStats}
              hiddenFeatureCount={hiddenFeatureCount}
            />
          )}

          {activeTab === 'check' && (
            <CheckTab
              horizon={horizon}
              loading={loading}
              data={data}
              checkSearch={checkSearch}
              setCheckSearch={setCheckSearch}
              checkResults={checkResults}
              setCheckResults={setCheckResults}
              setCheckFocused={setCheckFocused}
              selectedStock={selectedStock}
              setSelectedStock={setSelectedStock}
              indicators={indicators}
              setIndicators={setIndicators}
              checkLoading={checkLoading}
              checkError={checkError}
              setCheckError={setCheckError}
              autoPickLoading={autoPickLoading}
              autoPickError={autoPickError}
              autoPicks={autoPicks}
              conditionStats={conditionStats}
              returnProfile={returnProfile}
              minExpectedReturnPct={minExpectedReturnPct}
              setMinExpectedReturnPct={setMinExpectedReturnPct}
              minShortMomentumPct={minShortMomentumPct}
              setMinShortMomentumPct={setMinShortMomentumPct}
              minLiquidityEok={minLiquidityEok}
              setMinLiquidityEok={setMinLiquidityEok}
              investAmount={investAmount}
              setInvestAmount={setInvestAmount}
              checkWrapRef={checkWrapRef}
              selectStock={selectStock}
              goAnalyze={goAnalyze}
              goExecutionGuide={goExecutionGuide}
              goSimulator={goSimulator}
              addAutoPicksToSimulator={addAutoPicksToSimulator}
              applyReturnProfile={applyReturnProfile}
              patternMatch={patternMatch}
              matchedRuleCandidates={matchedRuleCandidates}
              investSim={investSim}
              autoPickBuckets={autoPickBuckets}
              showCheckDropdown={showCheckDropdown}
              hasFundamental={hasFundamental}
            />
          )}

          {activeTab === 'samples' && (
            <SamplesTab
              data={data}
              selectStock={selectStock}
              sorted={sorted}
              toggleSort={toggleSort}
              sortIcon={sortIcon}
            />
          )}
        </>
      )}
    </div>
  )
}
