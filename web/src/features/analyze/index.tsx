import React, { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../../lib/api'
import { type StockItem } from '../../lib/stockCache'
import Skeleton from '../../components/Skeleton'
import { useToast } from '../../components/ToastProvider'
import ShareModal from '../../components/ShareModal'
import { useShareManager } from '../../hooks/useShareManager'
import type { OhlcvCandle } from '../../lib/types'
import { useCurrentChatId } from '../../stores/profileStore'
import { defaultPlanItem, readSimulationPlan, saveSimulationPlan } from '../simulator/planStore'
import ChaseWarningNote from '../../components/ChaseWarningNote'
import DisclosureCheckCard from '../../components/DisclosureCheckCard'
import { ANALYZE_PENDING_CODE_KEY, EXECUTION_GUIDE_PENDING_KEY } from './constants'
import { getFlowMetricLabel } from './lib/flow'
import { buildAnalyzeShareUrl } from './lib/shareUrl'
import { calcChartHud, normalizeCandles } from './lib/candles'
import { calcPriceBarPct } from './lib/dates'
import { buildShareSummaryLines, buildSignalText } from './lib/shareSummary'
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
import { useLocalStorageBool } from './hooks/useLocalStorageBool'
import { useRecentSearches } from './hooks/useRecentSearches'

export default function AnalyzePage({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const chatId = useCurrentChatId()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<any | null>(null)
  const [candles, setCandles] = useState<OhlcvCandle[]>([])
  const [flow, setFlow] = useState<any | null>(null)
  const [creditShort, setCreditShort] = useState<any | null>(null)
  const [advisor, setAdvisor] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showExtendedIndicators, setShowExtendedIndicators] = useState(false)
  // 차트 토글 — localStorage에 저장, 기본값: HUD만 켜짐 / MA·세력선은 꺼짐
  const [showChartHud, setShowChartHud] = useLocalStorageBool('chart.showHud', true)
  const [showMaEmaOverlay, setShowMaEmaOverlay] = useLocalStorageBool('chart.showMaEma', false)
  const [showTradeMarkers, setShowTradeMarkers] = useLocalStorageBool('chart.showMarkers', true)
  const [showForceLine, setShowForceLine] = useLocalStorageBool('chart.showForce', false)
  const [recentSearches, pushRecentSearch] = useRecentSearches()
  const toast = useToast()

  const goRoute = (route: string) => {
    if (onNavigate) return onNavigate(route)
    try {
      window.history.pushState({}, '', `/${route}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    } catch {
      // ignore
    }
  }

  /** 분석한 종목을 시뮬레이터 계획에 더한다 (이미 있으면 그대로) — 투자금이 없으면 시뮬레이터가 시드로 채운다 */
  const addResultToSimulator = () => {
    if (!result?.code) return
    const existing = readSimulationPlan()
    const items = existing?.items ?? []
    if (!items.some((row) => row.code === result.code)) {
      items.push(defaultPlanItem({ code: String(result.code), name: String(result.name ?? result.code) }))
    }
    saveSimulationPlan({ createdAt: Date.now(), totalCapital: existing?.totalCapital ?? 0, notes: existing?.notes ?? '분석에서 추가', items })
    toast.show(`${result.name ?? result.code}을(를) 시뮬레이터 계획에 추가했습니다 (${items.length}종목).`)
    goRoute('simulator')
  }

  const sendResultToExecutionGuide = () => {
    if (!result?.code) return
    try {
      sessionStorage.setItem(EXECUTION_GUIDE_PENDING_KEY, JSON.stringify({ codes: [String(result.code)], source: 'analyze' }))
    } catch {
      // ignore
    }
    goRoute('execution-guide')
  }
  const shareManager = useShareManager({
    endpoint: '/api/ui/route-share',
    scopeKey: 'kind',
    requiresCode: false,
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

  const analyze = async (code?: string) => {
    const q = code ?? query.trim()
    if (!q) return

    setLoading(true)
    setError(null)
    setResult(null)
    setFlow(null)
    setCreditShort(null)
    setAdvisor(null)
    setCandles([])

    try {
      const chatQs = chatId ? `&chat_id=${encodeURIComponent(chatId)}` : ''
      const res = await apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(q)}${chatQs}`, { cacheMs: 0 })
      if (res?.profile || res?.latest) {
        const merged = { ...res.profile, ...res.latest }
        setResult(merged)
        if (merged.code && (merged.name || merged.code)) {
          pushRecentSearch({ code: merged.code, name: merged.name ?? merged.code })
        }
        // OHLCV 캔들 데이터: 서버 series를 OhlcvCandle 형태로 정규화
        const rawData: any[] = res?.data ?? []
        setCandles(normalizeCandles(rawData))
        setFlow(res?.flow ?? null)
        setCreditShort(res?.creditShort ?? null)
        setAdvisor(res?.advisor ?? null)
      } else if (res?.error) {
        setError(res.error)
      } else {
        setError('조회 결과 없음')
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!result?.code || typeof window === 'undefined') return
    try {
      const nextUrl = buildAnalyzeShareUrl(result.code)
      if (nextUrl !== window.location.href) {
        window.history.replaceState({}, '', nextUrl)
      }
    } catch {
      // ignore
    }
  }, [result?.code])

  const handleStockSelect = (stock: StockItem) => {
    analyze(stock.code)
  }

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const sharedCode = params.get('code')?.trim()
      const pending = sessionStorage.getItem(ANALYZE_PENDING_CODE_KEY)
      const initialCode = sharedCode || pending
      if (pending) {
        sessionStorage.removeItem(ANALYZE_PENDING_CODE_KEY)
      }
      if (initialCode) {
        setQuery(initialCode)
        void analyze(initialCode)
      }
    } catch {
      // ignore
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const priceBarPct = calcPriceBarPct(result)

  const shareSummaryLines = useMemo(() => buildShareSummaryLines(result, advisor), [advisor, result])

  const chartHud = useMemo(() => calcChartHud(candles), [candles])

  const signalText = useMemo(() => buildSignalText(advisor), [advisor])

  const analyzeCaptureId = result?.code ? `analyze-result-capture-${result.code}` : 'analyze-result-capture'

  const onShareAnalyze = async () => {
    const code = String(result?.code || query || '').trim()
    if (!code) {
      toast.show('먼저 종목을 조회해 주세요')
      return
    }
    const recentCloses = candles
      .slice(-10)
      .map((c) => Number(c.close))
      .filter((v) => Number.isFinite(v))
      .reverse()

    await shareManager.createShare('analyze', {
      kind: 'analyze',
      payload: {
        stock: {
          code,
          name: result?.name,
          price: result?.close,
          changePct: result?.change_pct,
          date: result?.date,
          open: result?.open,
          high: result?.high,
          low: result?.low,
          volume: result?.volume,
          marketCap: result?.market_cap,
          per: result?.per,
          pbr: result?.pbr,
          roe: result?.roe,
        },
        advisor: {
          statusLabel: advisor?.statusLabel,
          finalScore: advisor?.finalScore,
          entryLow: advisor?.entryLow,
          entryHigh: advisor?.entryHigh,
          target1: advisor?.target1,
          target2: advisor?.target2,
          stopPrice: advisor?.stopPrice,
        },
        summaryLines: shareSummaryLines,
        recentCloses,
      },
    })
  }

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
