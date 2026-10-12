import React, { useState, useMemo } from 'react'
import { type StockItem } from '../../lib/stockCache'
import Skeleton from '../../components/Skeleton'
import { useToast } from '../../components/ToastProvider'
import ShareModal from '../../components/ShareModal'
import { useCurrentChatId } from '../../stores/profileStore'
import ChaseWarningNote from '../../components/ChaseWarningNote'
import DisclosureCheckCard from '../../components/DisclosureCheckCard'
import { getFlowMetricLabel } from './lib/flow'
import { calcChartHud } from './lib/candles'
import { calcPriceBarPct } from './lib/dates'
import { buildSignalText } from './lib/shareSummary'
import { calcAnalysisCoverage, decideEntry, validateEntryGap } from './lib/validation'
import SearchHeader from './components/SearchHeader'
import ResultHead from './components/ResultHead'
import DecisionCard from './components/DecisionCard'
import PriceRangeBar from './components/PriceRangeBar'
import MarketRatiosSection from './components/MarketRatiosSection'
import FlowShortSection from './components/FlowShortSection'
import CandleSection from './components/CandleSection'
import SummarySection from './components/SummarySection'
import AdvisorSection from './components/AdvisorSection'
import { useAnalyzeActions } from './hooks/useAnalyzeActions'
import { useAnalyzeData } from './hooks/useAnalyzeData'
import { useLocalStorageBool } from './hooks/useLocalStorageBool'
import { useRecentSearches } from './hooks/useRecentSearches'

export default function AnalyzePage({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const chatId = useCurrentChatId()
  const [query, setQuery] = useState('')
  const [showExtendedIndicators, setShowExtendedIndicators] = useState(false)
  // 차트 토글 — localStorage에 저장, 기본값: HUD만 켜짐 / MA·세력선은 꺼짐
  const [showChartHud, setShowChartHud] = useLocalStorageBool('chart.showHud', true)
  const [showMaEmaOverlay, setShowMaEmaOverlay] = useLocalStorageBool('chart.showMaEma', false)
  const [showTradeMarkers, setShowTradeMarkers] = useLocalStorageBool('chart.showMarkers', true)
  const [showForceLine, setShowForceLine] = useLocalStorageBool('chart.showForce', false)
  const [recentSearches, pushRecentSearch] = useRecentSearches()
  const toast = useToast()

  // 훅 호출 순서 = 효과 실행 순서: 주소 갱신 → 마운트 이어받기(조회)
  const { result, candles, flow, creditShort, advisor, loading, error, analyze } = useAnalyzeData({
    chatId, query, setQuery, pushRecentSearch,
  })
  const { shareManager, addResultToSimulator, sendResultToExecutionGuide, onShareAnalyze } = useAnalyzeActions({
    result, advisor, candles, query, toast, onNavigate,
  })

  // 데이터 신뢰성 검증
  const dataValidation = useMemo(() => validateEntryGap(result, advisor), [result, advisor])
  const analysisCoverage = useMemo(() => calcAnalysisCoverage(result, flow, creditShort), [creditShort, flow, result])
  const entryDecision = useMemo(
    () => decideEntry(advisor, result, dataValidation, analysisCoverage.available),
    [advisor, analysisCoverage.available, dataValidation.isReliable, result?.close], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // 서버에서 내려온 값을 직접 사용한다. 클라이언트 재계산은 서버와 불일치를 유발한다.
  const computedSma20 = result?.sma20 ?? null
  const computedSma50 = result?.sma50 ?? null
  const computedSma200 = result?.sma200 ?? null
  const computedEma20 = result?.ema20 ?? null
  const computedEma50 = result?.ema50 ?? null
  const computedEma200 = result?.ema200 ?? null
  const computedRsi14 = result?.rsi14 ?? null
  const flowMetricLabel = getFlowMetricLabel(flow?.metric)
  const intradayDelta =
    result?.close != null && result?.open != null
      ? Number(result.close) - Number(result.open)
      : null

  const handleStockSelect = (stock: StockItem) => {
    analyze(stock.code)
  }

  const priceBarPct = calcPriceBarPct(result)

  const chartHud = useMemo(() => calcChartHud(candles), [candles])

  const signalText = useMemo(() => buildSignalText(advisor), [advisor])

  const analyzeCaptureId = result?.code ? `analyze-result-capture-${result.code}` : 'analyze-result-capture'

  return (
    <section className="container-app analyze-sheet xls-page-inset">
      <SearchHeader
        query={query}
        setQuery={setQuery}
        result={result}
        loading={loading}
        recentSearches={recentSearches}
        analyze={analyze}
        handleStockSelect={handleStockSelect}
        onShareAnalyze={onShareAnalyze}
        addResultToSimulator={addResultToSimulator}
        sendResultToExecutionGuide={sendResultToExecutionGuide}
        onNavigate={onNavigate}
      />

      {loading && <div className="card"><Skeleton lines={5} height={14} /></div>}

      {error && (
        <div className="state-error">
          <div className="state-error-title">{error}</div>
        </div>
      )}

      {result && !loading && (
        <div className="card card-lg analyze-sheet__result" id={analyzeCaptureId}>
          <ResultHead
            result={result}
          />

          <ChaseWarningNote changePct={result.change_pct} />
          <DisclosureCheckCard code={result.code} />

          <DecisionCard
            advisor={advisor}
            entryDecision={entryDecision}
            analysisCoverage={analysisCoverage}
            dataValidation={dataValidation}
          />

          {/* ── 일중 범위 바 ── */}
          <PriceRangeBar
            result={result}
            intradayDelta={intradayDelta}
            priceBarPct={priceBarPct}
          />

          {/* ── 시장 데이터 ── */}
          <MarketRatiosSection
            result={result}
          />

          {/* ── 수급/기술 ── */}
          <FlowShortSection
            result={result}
            flow={flow}
            creditShort={creditShort}
            computedSma20={computedSma20}
            computedSma50={computedSma50}
            computedSma200={computedSma200}
            computedEma20={computedEma20}
            computedEma50={computedEma50}
            computedEma200={computedEma200}
            computedRsi14={computedRsi14}
            flowMetricLabel={flowMetricLabel}
            showExtendedIndicators={showExtendedIndicators}
            setShowExtendedIndicators={setShowExtendedIndicators}
          />

          {/* ── 캔들 차트 ── */}
          <CandleSection
            advisor={advisor}
            candles={candles}
            chartHud={chartHud}
            signalText={signalText}
            showChartHud={showChartHud}
            setShowChartHud={setShowChartHud}
            showMaEmaOverlay={showMaEmaOverlay}
            setShowMaEmaOverlay={setShowMaEmaOverlay}
            showTradeMarkers={showTradeMarkers}
            setShowTradeMarkers={setShowTradeMarkers}
            showForceLine={showForceLine}
            setShowForceLine={setShowForceLine}
          />

          {/* ── 현황 요약 ── */}
          <SummarySection
            result={result}
            flow={flow}
            creditShort={creditShort}
          />

          {/* ── 어드바이저 ── */}
          <AdvisorSection
            result={result}
            advisor={advisor}
            dataValidation={dataValidation}
          />

          {result.sector && (
            <div className="caption" style={{ marginTop: 'var(--space-4)' }}>섹터: {result.sector}</div>
          )}
        </div>
      )}
      <ShareModal
        open={shareManager.open}
        onClose={shareManager.close}
        url={shareManager.info?.url}
        code={shareManager.info?.code}
        requiresCode={shareManager.requiresCode}
        expiresAt={shareManager.info?.expiresAt}
        shares={shareManager.list}
        loading={shareManager.loading}
        onRefresh={() => { void shareManager.loadList('analyze') }}
        includeAll={shareManager.includeAll}
        onChangeIncludeAll={shareManager.setIncludeAll}
        onRevoke={shareManager.revokeShare}
        revokingId={shareManager.revokingId}
      />
    </section>
  )
}
