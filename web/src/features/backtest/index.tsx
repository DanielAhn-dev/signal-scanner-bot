import React, { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { AutoPickTier, BacktestTab } from './types'
import { bucketAutoPicks } from './lib/autoPick'
import {
  computeInvestSim,
  computeVisibleHorizons,
  filterFeatureStats,
  hasExtendedHorizon as hasExtendedHorizonData,
  sortRisers,
  type SortDir,
  type SortKey,
} from './lib/backtestView'
import {
  addAutoPicksToSimulator as addAutoPicksToSimulatorFor,
  goAnalyze,
  goExecutionGuide,
  goSimulator,
} from './lib/navigation'
import { buildPatternMatch } from './lib/patternMatch'
import { filterSamplesByRule, isRuleKeyMatched } from './lib/ruleMatch'
import { useAutoPicks } from './hooks/useAutoPicks'
import { useBacktestRun } from './hooks/useBacktestRun'
import { useReturnProfile } from './hooks/useReturnProfile'
import { useStockCheck } from './hooks/useStockCheck'
import BacktestSkeleton from './components/BacktestSkeleton'
import ParamsCard from './components/ParamsCard'
import SummaryTab from './components/SummaryTab'
import CheckTab from './components/CheckTab'
import SamplesTab from './components/SamplesTab'

export default function BacktestPage() {
  const [activeTab, setActiveTab] = useState<BacktestTab>('summary')
  const [showAllFeatureRows, setShowAllFeatureRows] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('forwardReturnPct')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [investAmount, setInvestAmount] = useState(1_000_000)

  const {
    horizon, setHorizon, lookbackDays, setLookbackDays, rallyPct, setRallyPct, topN, setTopN,
    loading, error, data, load, selectedRuleKey, setSelectedRuleKey,
  } = useBacktestRun()
  const {
    returnProfile, minExpectedReturnPct, setMinExpectedReturnPct, minShortMomentumPct, setMinShortMomentumPct,
    minLiquidityEok, setMinLiquidityEok, applyReturnProfile,
  } = useReturnProfile()
  const { autoPickLoading, autoPickError, autoPicks, conditionStats } = useAutoPicks({
    data, selectedRuleKey, returnProfile, minExpectedReturnPct, minShortMomentumPct, minLiquidityEok,
  })
  const {
    checkSearch, setCheckSearch, checkResults, setCheckResults, checkFocused, setCheckFocused,
    selectedStock, setSelectedStock, indicators, setIndicators, checkLoading, checkError, setCheckError,
    checkWrapRef, selectStock,
  } = useStockCheck(setActiveTab)

  const addAutoPicksToSimulator = (tiers: AutoPickTier[]) => addAutoPicksToSimulatorFor(autoPicks, tiers)

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
