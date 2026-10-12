import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSyncedSettings } from '../../lib/userState'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { formatKstDateTime, formatNumber } from '../../lib/format'
import { ErrorState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
import useWatchlistActions from '../../hooks/useWatchlistActions'
import ShareModal from '../../components/ShareModal'
import { useShareManager } from '../../hooks/useShareManager'
import { scoreLeadAccumulationCandidate } from '../../lib/accumulationSignal'
import type { MarketPhase, ConditionFilter, SignalHistoryMap, SignalAgeMeta, ConfirmPromotionTrendMeta, StrategyMetricSummary, StrategyDrilldownItem, StrategyCoverageSummary, StrategyLookbackDays, SortDirection, SortKey, ScanCandidate, ScanHighlightItem } from './types'
import { ANALYZE_PENDING_CODE_KEY, EXECUTION_GUIDE_PENDING_KEY, CONDITION_FILTER_OPTIONS, BASIC_CONDITION_FILTER_KEYS, ALL_CONDITION_FILTER_KEYS, CONDITION_FILTER_LABEL_MAP, STRATEGY_FILTER_BY_METRIC_KEY, STRATEGY_METRIC_KEY_BY_FILTER, STRATEGY_BASE_POSITION_R, STRATEGY_GUIDE_BY_FILTER, FILTER_DEFAULT_SORT } from './constants'
import { getKstDateKey, normalizeDateKey, uniqueSortedDateKeys, computeSignalAgeDays } from './lib/dateKeys'
import { readSignalHistory, writeSignalHistory, readScanSnapshot, writeScanSnapshot, buildCandidateSignature } from './lib/snapshot'
import { gradeScore, computePriorityScore, computeQuickTradeScore } from './lib/candidateScore'
import { isQuickTradeCandidate, isQuickTradeLiteCandidate, isDayStrategyCandidate, isOvernightStrategyCandidate, isWeeklyStrategyCandidate, isCandidateStage, isConfirmStage, isBuycheckStage } from './lib/candidateStage'
import { toComparableValue } from './lib/sorting'
import { getStrategyRiskTier, getTierAdjustedPosition } from './lib/strategyRisk'
import ScanHeader from './components/ScanHeader'
import StrategyMetricsPanel from './components/StrategyMetricsPanel'
import StrategyGuideCard from './components/StrategyGuideCard'
import StrategyDrilldown from './components/StrategyDrilldown'
import HighlightsSection from './components/HighlightsSection'
import CandidateTable from './components/CandidateTable'
import type { ScanPanelState } from './types'

export default function ScanPage({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const snapshot = readScanSnapshot()
  const [signalHistory, setSignalHistory] = useState<SignalHistoryMap>(() => readSignalHistory())
  const [candidates, setCandidates] = useState<ScanCandidate[]>(() => snapshot?.candidates ?? [])
  const [total, setTotal] = useState(() => snapshot?.total ?? 0)
  const [latestDate, setLatestDate] = useState<string | null>(() => snapshot?.latestDate ?? null)
  const [marketPhase, setMarketPhase] = useState<MarketPhase>(() => (
    snapshot?.marketPhase === 'intraday' ? 'intraday' : 'after-close'
  ))
  const [realtimeAppliedCount, setRealtimeAppliedCount] = useState<number>(() => snapshot?.realtimeAppliedCount ?? 0)
  const [confirmPromotionTrend, setConfirmPromotionTrend] = useState<ConfirmPromotionTrendMeta | null>(
    () => snapshot?.confirmPromotionTrend ?? null,
  )
  const [holdingCount, setHoldingCount] = useState<number | null>(null)
  const [holdingCountLoading, setHoldingCountLoading] = useState(false)
  const [holdingCountUpdatedAt, setHoldingCountUpdatedAt] = useState<number | null>(null)
  const [buycheckMaxHoldings, setBuycheckMaxHoldings] = useState<number>(8)
  const [buycheckHighlightTopN, setBuycheckHighlightTopN] = useState<number>(5)
  const [loading, setLoading] = useState(() => !snapshot)
  const [error, setError] = useState<string | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [strategyMetrics, setStrategyMetrics] = useState<StrategyMetricSummary[]>([])
  const [recent30MetricsMap, setRecent30MetricsMap] = useState<Record<StrategyMetricSummary['key'], StrategyMetricSummary | null>>({
    day: null,
    overnight: null,
    weekly: null,
  })
  const [strategyMetricsLoading, setStrategyMetricsLoading] = useState(true)
  const [strategyLookbackDays, setStrategyLookbackDays] = useState<StrategyLookbackDays>(120)
  const [strategyCoverage, setStrategyCoverage] = useState<StrategyCoverageSummary | null>(null)
  const [strategyCoverageLoading, setStrategyCoverageLoading] = useState(false)
  const [strategyDrilldown, setStrategyDrilldown] = useState<StrategyDrilldownItem[]>([])
  const [strategyDrilldownLoading, setStrategyDrilldownLoading] = useState(false)
  const [strategyDrilldownError, setStrategyDrilldownError] = useState<string | null>(null)
  const [apiHighlights, setApiHighlights] = useState<ScanHighlightItem[]>([])
  const [highlightLoading, setHighlightLoading] = useState(true)
  const [selectedSector, setSelectedSector] = useState<string>('all')
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>('all')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('priority_score')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(1)
  const [isMobileViewport, setIsMobileViewport] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false
  ))
  const pageSize = 20
  const toast = useToast()
  const shareManager = useShareManager({
    endpoint: '/api/ui/route-share',
    scopeKey: 'kind',
    requiresCode: false,
  })
  const toastRef = useRef(toast)
  const lastSignatureRef = useRef<string | null>(null)
  const hasFetchedRef = useRef(false)
  const filterChipScrollRef = useRef<HTMLDivElement | null>(null)
  const activeStrategyMetricKey = useMemo(
    () => STRATEGY_METRIC_KEY_BY_FILTER[conditionFilter] ?? null,
    [conditionFilter],
  )

  useEffect(() => {
    toastRef.current = toast
  }, [toast])
  const {
    loadWatchlistCodes,
    isWatched,
    isAdding,
    isRemoving,
    addToWatchlist,
    removeFromWatchlist,
  } = useWatchlistActions()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const nextSector = String(params.get('sector') || '').trim()
    const nextFilter = String(params.get('filter') || '').trim()

    if (nextSector) setSelectedSector(nextSector)
    if (ALL_CONDITION_FILTER_KEYS.includes(nextFilter as ConditionFilter)) {
      setConditionFilter(nextFilter as ConditionFilter)
    }
  }, [])

  useEffect(() => {
    if (conditionFilter !== 'all' && !BASIC_CONDITION_FILTER_KEYS.has(conditionFilter)) {
      setShowAdvancedFilters(true)
    }
  }, [conditionFilter])

  const advancedConditionOptions = useMemo(() => {
    return CONDITION_FILTER_OPTIONS.filter((option) => {
      if (!option.advanced) return false
      if (showAdvancedFilters) return true
      return option.key === conditionFilter
    })
  }, [showAdvancedFilters, conditionFilter])

  const asOfDateKey = useMemo(() => normalizeDateKey(latestDate) ?? getKstDateKey(), [latestDate])
  const signalAgeByCode = useMemo(() => {
    const map = new Map<string, SignalAgeMeta>()

    for (const item of candidates) {
      const code = String(item.code || '').trim()
      if (!code) continue
      const strictAge = Number(item.quick_signal_age_days)
      const quickLiteAge = Number(item.quick_lite_signal_age_days)
      const hasStrictAge = Number.isFinite(strictAge) && strictAge >= 0
      const hasQuickLiteAge = Number.isFinite(quickLiteAge) && quickLiteAge >= 0
      if (hasStrictAge || hasQuickLiteAge) {
        map.set(code, {
          strictAgeDays: hasStrictAge ? strictAge : null,
          quickLiteAgeDays: hasQuickLiteAge ? quickLiteAge : null,
        })
      }
    }

    const entries = Object.entries(signalHistory)
    if (entries.length === 0) return map
    for (const [code, record] of entries) {
      if (map.has(code)) continue
      const strictDate = record.strictQuickDates[0] ?? null
      const quickLiteDate = record.quickLiteDates[0] ?? null
      map.set(code, {
        strictAgeDays: computeSignalAgeDays(strictDate, asOfDateKey),
        quickLiteAgeDays: computeSignalAgeDays(quickLiteDate, asOfDateKey),
      })
    }
    return map
  }, [asOfDateKey, candidates, signalHistory])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(max-width: 640px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  useEffect(() => {
    const container = filterChipScrollRef.current
    if (!container) return
    const active = container.querySelector<HTMLButtonElement>('button.tag.active')
    if (!active) return
    active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [conditionFilter])

  const handleFilterChipWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const container = filterChipScrollRef.current
    if (!container) return
    const horizontalDelta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY
    if (!horizontalDelta) return
    container.scrollLeft += horizontalDelta
    event.preventDefault()
  }, [])

  const handleFilterChipKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = filterChipScrollRef.current
    if (!container) return
    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('button.tag'))
    if (chips.length === 0) return
    const activeElement = document.activeElement as HTMLElement | null
    const currentIdx = chips.findIndex((chip) => chip === activeElement)
    const startIdx = currentIdx >= 0 ? currentIdx : chips.findIndex((chip) => chip.classList.contains('active'))

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const base = startIdx >= 0 ? startIdx : 0
      const nextIdx = (base + delta + chips.length) % chips.length
      const target = chips[nextIdx]
      target?.focus()
      target?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      event.preventDefault()
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      const idx = startIdx >= 0 ? startIdx : 0
      chips[idx]?.click()
      event.preventDefault()
      return
    }

    if (event.key === 'Home') {
      chips[0]?.focus()
      chips[0]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
      event.preventDefault()
      return
    }

    if (event.key === 'End') {
      const last = chips[chips.length - 1]
      last?.focus()
      last?.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' })
      event.preventDefault()
    }
  }, [])

  const loadHoldingCount = useCallback(async () => {
    setHoldingCountLoading(true)
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '1',
        includeLots: '0',
        positionType: 'holding',
        withCount: '1',
        cacheMs: '0',
      })
      const json = await apiFetch(`/api/ui/positions?${params.toString()}`, {
        cacheMs: 0,
        timeoutMs: 12_000,
        retries: 1,
      })
      const nextCountRaw = Number(json?.count)
      const fallbackCount = Array.isArray(json?.data) ? json.data.length : 0
      const nextCount = Number.isFinite(nextCountRaw) ? nextCountRaw : fallbackCount
      setHoldingCount(Math.max(0, Math.trunc(nextCount)))
      setHoldingCountUpdatedAt(Date.now())
    } catch {
      // 보유수 조회 실패는 스캔 기능을 막지 않는다.
    } finally {
      setHoldingCountLoading(false)
    }
  }, [])

  const loadCandidates = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    setError(null)
    try {
      const ts = Date.now()
      const res = await apiFetch(`/api/ui/scan-candidates?limit=80&cacheMs=0&_ts=${ts}`, {
        cacheMs: 0,
        timeoutMs: 25_000,
      })
      const nextCandidates = Array.isArray(res?.data) ? (res.data as ScanCandidate[]) : []
      const nextSignature = buildCandidateSignature(nextCandidates)
      const prevSignature = lastSignatureRef.current

      if (!options?.silent && hasFetchedRef.current) {
        if (prevSignature === nextSignature) {
          toastRef.current.show(`데이터 동일 · 기준일 ${res?.latestDate ?? '—'} · ${res?.marketPhase === 'intraday' ? '장중(현재가 반영 없음/미미)' : '종가 기준'}`)
        } else {
          toastRef.current.show(`데이터 업데이트 감지 · 기준일 ${res?.latestDate ?? '—'}`)
        }
      }

      lastSignatureRef.current = nextSignature
      hasFetchedRef.current = true

      setCandidates(nextCandidates)
      setTotal(res?.count ?? 0)
      setLatestDate(res?.latestDate ?? null)
      setMarketPhase(res?.marketPhase === 'intraday' ? 'intraday' : 'after-close')
      setRealtimeAppliedCount(Number(res?.realtimeAppliedCount ?? 0))
      setConfirmPromotionTrend(res?.confirmPromotionTrend ?? null)
      setSignalHistory((prev) => {
        const dateKey = normalizeDateKey(res?.latestDate) ?? getKstDateKey()
        const next: SignalHistoryMap = { ...prev }
        for (const item of nextCandidates) {
          const code = String(item.code || '').trim()
          if (!code) continue
          const current = next[code] ?? { seenDates: [], strictQuickDates: [], quickLiteDates: [] }
          next[code] = {
            seenDates: uniqueSortedDateKeys([...current.seenDates, dateKey], 20),
            strictQuickDates: uniqueSortedDateKeys(
              isQuickTradeCandidate(item) ? [...current.strictQuickDates, dateKey] : current.strictQuickDates,
              20,
            ),
            quickLiteDates: uniqueSortedDateKeys(
              isQuickTradeLiteCandidate(item) ? [...current.quickLiteDates, dateKey] : current.quickLiteDates,
              20,
            ),
          }
        }
        writeSignalHistory(next)
        return next
      })
      writeScanSnapshot({
        candidates: nextCandidates,
        total: res?.count ?? 0,
        latestDate: res?.latestDate ?? null,
        marketPhase: res?.marketPhase === 'intraday' ? 'intraday' : 'after-close',
        realtimeAppliedCount: Number(res?.realtimeAppliedCount ?? 0),
        confirmPromotionTrend: (res?.confirmPromotionTrend ?? null) as ConfirmPromotionTrendMeta | null,
      })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCandidates()
  }, [loadCandidates])

  useEffect(() => {
    void loadHoldingCount()
  }, [loadHoldingCount])

  useEffect(() => {
    if (conditionFilter !== 'buycheck') return
    const staleMs = holdingCountUpdatedAt == null ? Number.POSITIVE_INFINITY : Date.now() - holdingCountUpdatedAt
    if (staleMs > 60_000 && !holdingCountLoading) {
      void loadHoldingCount()
    }
  }, [conditionFilter, holdingCountUpdatedAt, holdingCountLoading, loadHoldingCount])

  useSyncedSettings(
    'buycheck',
    { maxHoldings: buycheckMaxHoldings, highlightTopN: buycheckHighlightTopN },
    { maxHoldings: 8, highlightTopN: 5 },
    (saved) => {
      const maxHoldings = Number(saved.maxHoldings)
      const highlightTopN = Number(saved.highlightTopN)
      if (Number.isFinite(maxHoldings)) setBuycheckMaxHoldings(Math.max(1, Math.min(30, Math.trunc(maxHoldings))))
      if (Number.isFinite(highlightTopN)) setBuycheckHighlightTopN(Math.max(1, Math.min(15, Math.trunc(highlightTopN))))
    },
  )

  useEffect(() => {
    setHighlightLoading(true)
    apiFetch('/api/ui/scan-highlights', { cacheMs: 60_000, timeoutMs: 30_000 })
      .then((res) => { if (Array.isArray(res?.data)) setApiHighlights(res.data) })
      .catch(() => { /* API 호출 실패 시 로컈 폴백 사용 */ })
      .finally(() => setHighlightLoading(false))
  }, [])

  useEffect(() => {
    setStrategyMetricsLoading(true)
    apiFetch(`/api/ui/scan-strategy-metrics?lookbackDays=${strategyLookbackDays}`, { cacheMs: 90_000, timeoutMs: 35_000 })
      .then((res) => {
        const metrics = Array.isArray(res?.summary?.metrics) ? res.summary.metrics : []
        setStrategyMetrics(metrics as StrategyMetricSummary[])
      })
      .catch(() => {
        setStrategyMetrics([])
      })
      .finally(() => setStrategyMetricsLoading(false))
  }, [strategyLookbackDays])

  useEffect(() => {
    setStrategyCoverageLoading(true)
    apiFetch(`/api/ui/scan-strategy-coverage?lookbackDays=${strategyLookbackDays}`, { cacheMs: 120_000, timeoutMs: 35_000 })
      .then((res) => {
        const hasStrategies = res?.strategies && typeof res.strategies === 'object'
        if (!hasStrategies) {
          setStrategyCoverage(null)
          return
        }
        setStrategyCoverage(res as StrategyCoverageSummary)
      })
      .catch(() => setStrategyCoverage(null))
      .finally(() => setStrategyCoverageLoading(false))
  }, [strategyLookbackDays])

  useEffect(() => {
    apiFetch('/api/ui/scan-strategy-metrics?lookbackDays=30', { cacheMs: 120_000, timeoutMs: 35_000 })
      .then((res) => {
        const metrics = (Array.isArray(res?.summary?.metrics) ? res.summary.metrics : []) as StrategyMetricSummary[]
        const next: Record<StrategyMetricSummary['key'], StrategyMetricSummary | null> = { day: null, overnight: null, weekly: null }
        for (const metric of metrics) {
          if (metric?.key && Object.prototype.hasOwnProperty.call(next, metric.key)) {
            next[metric.key] = metric
          }
        }
        setRecent30MetricsMap(next)
      })
      .catch(() => {
        setRecent30MetricsMap({ day: null, overnight: null, weekly: null })
      })
  }, [])

  useEffect(() => {
    if (!activeStrategyMetricKey) {
      setStrategyDrilldown([])
      setStrategyDrilldownError(null)
      setStrategyDrilldownLoading(false)
      return
    }

    setStrategyDrilldownLoading(true)
    setStrategyDrilldownError(null)
    apiFetch(
      `/api/ui/scan-strategy-drilldown?strategy=${activeStrategyMetricKey}&lookbackDays=${strategyLookbackDays}&limit=30`,
      { cacheMs: 60_000, timeoutMs: 35_000 },
    )
      .then((res) => {
        const items = Array.isArray(res?.items) ? (res.items as StrategyDrilldownItem[]) : []
        setStrategyDrilldown(items)
      })
      .catch((e: any) => {
        setStrategyDrilldown([])
        setStrategyDrilldownError(String(e?.message || '근거 데이터를 불러오지 못했습니다.'))
      })
      .finally(() => setStrategyDrilldownLoading(false))
  }, [activeStrategyMetricKey, strategyLookbackDays])

  useEffect(() => {
    loadWatchlistCodes().catch(() => {
      // 관심종목 조회 실패 시에도 스캔 화면은 계속 사용 가능해야 함
    })
  }, [loadWatchlistCodes])

  const triggerScan = async () => {
    setScanLoading(true)
    toast.show('동기화 시작 중… 완료까지 수 분 소요될 수 있습니다.')
    try {
      const res = await apiFetch('/api/ui/trigger-update', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 180_000,
        body: JSON.stringify({
          runScripts: true,
          pipeline: 'intraday-refresh',
        }),
      })
      if (res?.ok) {
        const runnerEnabled = !!res?.scriptRunner?.enabled
        const runnerRequested = !!res?.scriptRunner?.requested
        const runnerOk = !!res?.scriptRunner?.result?.ok

        if (runnerRequested && !runnerEnabled) {
          toast.show('DB 갱신만 완료됨(장중 신호 재계산 스크립트 비활성). 서버 ENABLE_WEB_SCRIPT_RUNNER 확인 필요')
        } else if (runnerRequested && !runnerOk) {
          toast.show('DB 갱신 완료, 장중 신호 재계산 일부 실패(서버 로그 확인 필요)')
        } else {
          toast.show('장중 눌림목 재계산 완료')
        }
        await Promise.all([loadCandidates(), loadHoldingCount()])
      } else {
        const detail = res?.body?.error || res?.error || '스캔 요청 실패'
        toast.show(`동기화 실패: ${String(detail)}`)
      }
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (msg.toLowerCase().includes('timed out') || msg.toLowerCase().includes('network error') || msg.toLowerCase().includes('failed to fetch')) {
        toast.show('서버 응답 시간 초과. 동기화는 백그라운드에서 계속 실행될 수 있습니다. 잠시 후 새로고침해 주세요.')
      } else {
        toast.show(`오류: ${msg}`)
      }
    } finally {
      setScanLoading(false)
    }
  }

  const navigateToAnalyze = (code: string) => {
    try { sessionStorage.setItem(ANALYZE_PENDING_CODE_KEY, code) } catch { /* ignore */ }
    onNavigate?.('analyze')
  }

  const navigateToExecutionGuide = (code: string) => {
    try {
      sessionStorage.setItem(
        EXECUTION_GUIDE_PENDING_KEY,
        JSON.stringify({ codes: [code], source: 'scan' }),
      )
    } catch {
      // ignore
    }
    onNavigate?.('execution-guide')
  }

  const navigateToBacktest = (code: string) => {
    try { sessionStorage.setItem('backtest_pending_code', code) } catch { /* ignore */ }
    if (onNavigate) {
      onNavigate('backtest')
    } else {
      window.location.href = '/backtest'
    }
  }

  const sectors = useMemo(
    () => ['all', ...new Set(candidates.map((row) => row.sector_id).filter((v): v is string => !!v))],
    [candidates],
  )

  const localHighlights = useMemo<ScanHighlightItem[]>(() => {
    return [...candidates]
      .map((c) => {
        const lead = scoreLeadAccumulationCandidate(c)
        return {
          ...c,
          leadAccumulationStage: lead.stage,
          leadAccumulationScore: lead.score,
          isAccumulationSignal: lead.stage !== 'none' && lead.score >= 55,
        }
      })
      .filter(c => ['A', 'B'].includes(String(c.entry_grade || '').toUpperCase()))
      .sort((a, b) => {
        const aAcc = a.isAccumulationSignal ? 1 : 0
        const bAcc = b.isAccumulationSignal ? 1 : 0
        if (aAcc !== bAcc) return bAcc - aAcc
        const leadA = a.leadAccumulationScore ?? 0
        const leadB = b.leadAccumulationScore ?? 0
        if (leadA !== leadB) return leadB - leadA
        const ga = gradeScore(a.entry_grade)
        const gb = gradeScore(b.entry_grade)
        if (ga !== gb) return gb - ga
        const wa = a.warn_score ?? 999
        const wb = b.warn_score ?? 999
        if (wa !== wb) return wa - wb
        return (b.entry_score ?? 0) - (a.entry_score ?? 0)
      })
      .slice(0, 5)
  }, [candidates])

  // 스캔 화면은 눌림목 원본 후보 기반 TOP 카드로 유지한다.
  const activeHighlights = localHighlights
  const highlightOverlapSet = useMemo(() => new Set(apiHighlights.map((row) => row.code)), [apiHighlights])

  const filterCounts = useMemo(() => {
    const base = selectedSector === 'all' ? candidates : candidates.filter(c => c.sector_id === selectedSector)
    return {
      all: base.length,
      candidate: base.filter((c) => isCandidateStage(c)).length,
      confirm: base.filter((c) => isConfirmStage(c)).length,
      buycheck: base.filter((c) => isBuycheckStage(c)).length,
      entry: base.filter(c => ['A', 'B'].includes(String(c.entry_grade || '').toUpperCase())).length,
      trend: base.filter(c => ['A', 'B'].includes(String(c.trend_grade || '').toUpperCase())).length,
      accumulation: base.filter(c => ['A', 'B'].includes(String(c.dist_grade || '').toUpperCase())).length,
      lead: base.filter((c) => scoreLeadAccumulationCandidate(c).stage !== 'none').length,
      accumulation_signal: base.filter((c) => {
        const lead = scoreLeadAccumulationCandidate(c)
        return lead.stage !== 'none' && lead.score >= 55
      }).length,
      stable: base.filter(c => ['A', 'B'].includes(String(c.pivot_grade || '').toUpperCase())).length,
      quick: base.filter((c) => isQuickTradeCandidate(c)).length,
      quick_lite: base.filter((c) => isQuickTradeLiteCandidate(c)).length,
      signal_d1: base.filter((c) => signalAgeByCode.get(c.code)?.quickLiteAgeDays === 1).length,
      signal_d2: base.filter((c) => signalAgeByCode.get(c.code)?.quickLiteAgeDays === 2).length,
      strategy_day: base.filter((c) => isDayStrategyCandidate(c)).length,
      strategy_overnight: base.filter((c) => isOvernightStrategyCandidate(c, signalAgeByCode.get(c.code))).length,
      strategy_weekly: base.filter((c) => isWeeklyStrategyCandidate(c)).length,
    }
  }, [candidates, selectedSector, signalAgeByCode])

  const confirmPromotionMeta = useMemo(() => {
    const base = Number(filterCounts.candidate ?? 0)
    const promoted = Number(filterCounts.confirm ?? 0)
    const ratio = base > 0 ? (promoted / base) * 100 : 0
    const latest5Avg = Number(confirmPromotionTrend?.latest5AvgRatioPct)
    const trendDelta = Number(confirmPromotionTrend?.trendDeltaPct)
    const safeLatest5Avg = Number.isFinite(latest5Avg) ? latest5Avg : null
    const safeTrendDelta = Number.isFinite(trendDelta) ? trendDelta : null
    return {
      base,
      promoted,
      ratioPct: Number.isFinite(ratio) ? Math.round(ratio) : 0,
      latest5AvgRatioPct: safeLatest5Avg,
      trendDeltaPct: safeTrendDelta,
      trendSampleDays: Number(confirmPromotionTrend?.sampleDays ?? 0),
      recentRatios: Array.isArray(confirmPromotionTrend?.daily)
        ? confirmPromotionTrend.daily
            .slice()
            .reverse()
            .map((item) => Number(item.ratioPct))
            .filter((value) => Number.isFinite(value))
        : [],
    }
  }, [filterCounts, confirmPromotionTrend])

  const buycheckRiskGuard = useMemo(() => {
    const recommendedMax = Math.max(1, Math.min(30, Math.trunc(buycheckMaxHoldings || 8)))
    const count = holdingCount
    const overLimit = count != null && count > recommendedMax
    const remainingSlots = count != null ? Math.max(0, recommendedMax - count) : null
    const label = holdingCountLoading
      ? '매수검토 리스크 가드: 현재 보유 종목 수 확인 중...'
      : count == null
        ? `매수검토 리스크 가드: 1회 손절 -3.5% 고정 · 동시 보유 최대 ${recommendedMax}종목 권장 · 신규 진입은 분할(2~3회) 기준`
        : overLimit
          ? `매수검토 리스크 가드: 현재 실제 보유 ${count}종목(권장 ${recommendedMax}종목 초과) · 신규 진입 보류 + 기존 포지션 리밸런싱 우선`
          : `매수검토 리스크 가드: 현재 실제 보유 ${count}종목 · 추가 가능 슬롯 ${remainingSlots}개 · 신규 진입은 분할(2~3회) 기준`

    return {
      label,
      overLimit,
      recommendedMax,
      remainingSlots,
    }
  }, [holdingCount, holdingCountLoading, buycheckMaxHoldings])

  const filteredCandidates = useMemo(() => candidates.filter((item) => {
    if (selectedSector !== 'all' && item.sector_id !== selectedSector) return false
    if (conditionFilter === 'candidate') return isCandidateStage(item)
    if (conditionFilter === 'confirm') return isConfirmStage(item)
    if (conditionFilter === 'buycheck') return isBuycheckStage(item)
    if (conditionFilter === 'entry') return ['A', 'B'].includes(String(item.entry_grade || '').toUpperCase())
    if (conditionFilter === 'trend') return ['A', 'B'].includes(String(item.trend_grade || '').toUpperCase())
    if (conditionFilter === 'accumulation') return ['A', 'B'].includes(String(item.dist_grade || '').toUpperCase())
    if (conditionFilter === 'lead') return scoreLeadAccumulationCandidate(item).stage !== 'none'
    if (conditionFilter === 'accumulation_signal') {
      const lead = scoreLeadAccumulationCandidate(item)
      return lead.stage !== 'none' && lead.score >= 55
    }
    if (conditionFilter === 'stable') return ['A', 'B'].includes(String(item.pivot_grade || '').toUpperCase())
    if (conditionFilter === 'quick') return isQuickTradeCandidate(item)
    if (conditionFilter === 'quick_lite') return isQuickTradeLiteCandidate(item)
    if (conditionFilter === 'signal_d1') return signalAgeByCode.get(item.code)?.quickLiteAgeDays === 1
    if (conditionFilter === 'signal_d2') return signalAgeByCode.get(item.code)?.quickLiteAgeDays === 2
    if (conditionFilter === 'strategy_day') return isDayStrategyCandidate(item)
    if (conditionFilter === 'strategy_overnight') return isOvernightStrategyCandidate(item, signalAgeByCode.get(item.code))
    if (conditionFilter === 'strategy_weekly') return isWeeklyStrategyCandidate(item)
    return true
  }), [candidates, selectedSector, conditionFilter, signalAgeByCode])

  const tableCandidates = useMemo(() => {
    if (conditionFilter !== 'all' || selectedSector !== 'all') return filteredCandidates
    if (activeHighlights.length === 0) return filteredCandidates
    const highlightCodes = new Set(activeHighlights.map((row) => row.code))
    return filteredCandidates.filter((row) => !highlightCodes.has(row.code))
  }, [activeHighlights, conditionFilter, filteredCandidates, selectedSector])

  const sortedCandidates = useMemo(() => {
    const forceBuycheckPrioritySort = conditionFilter === 'buycheck' && buycheckRiskGuard.overLimit
    const effectiveSortKey: SortKey = forceBuycheckPrioritySort ? 'priority_score' : sortKey
    const effectiveSortDirection: SortDirection = forceBuycheckPrioritySort ? 'desc' : sortDirection

    return [...tableCandidates].sort((a, b) => {
      const av = toComparableValue(a, effectiveSortKey)
      const bv = toComparableValue(b, effectiveSortKey)
      const result = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'ko-KR')
      return effectiveSortDirection === 'asc' ? result : -result
    })
  }, [tableCandidates, sortKey, sortDirection, conditionFilter, buycheckRiskGuard.overLimit])

  const pagedCandidates = useMemo(() => {
    const from = (page - 1) * pageSize
    const topHighlightCount = Math.max(1, Math.min(15, Math.trunc(buycheckHighlightTopN || 5)))
    const highlightTopMode = conditionFilter === 'buycheck' && buycheckRiskGuard.overLimit
    return sortedCandidates.slice(from, from + pageSize).map((s, localIdx) => {
      const absoluteIdx = from + localIdx
      const isExecutionPriority = highlightTopMode && absoluteIdx < topHighlightCount
      return {
        ...s,
        isExecutionPriority,
        executionPriorityRank: isExecutionPriority ? absoluteIdx + 1 : null,
      }
    })
  }, [sortedCandidates, page, buycheckHighlightTopN, conditionFilter, buycheckRiskGuard.overLimit])

  const totalPages = Math.ceil(sortedCandidates.length / pageSize)

  const displayRows = useMemo(() => pagedCandidates.map((s: any) => ({
    strategyLabel: isDayStrategyCandidate(s)
      ? '데이'
      : isOvernightStrategyCandidate(s, signalAgeByCode.get(s.code))
        ? '오버나이트'
        : isWeeklyStrategyCandidate(s)
          ? '주간'
          : '관찰',
    ...s,
    priorityScore: Number(computePriorityScore(s).toFixed(1)),
    quickTradeScore: Number(computeQuickTradeScore(s).toFixed(1)),
    leadAccumulationScore: Number(scoreLeadAccumulationCandidate(s).score.toFixed(1)),
    leadAccumulationStage: scoreLeadAccumulationCandidate(s).stage,
    quickLiteAgeDays: signalAgeByCode.get(s.code)?.quickLiteAgeDays ?? null,
    intradayChangePct: typeof s.intraday_change_pct === 'number' ? s.intraday_change_pct : null,
    tradeDateText: s.trade_date ?? '—',
    updatedAtText: s.stock_updated_at ? formatKstDateTime(s.stock_updated_at) : null,
    updatedDateText: formatKstDateTime(s.stock_updated_at, { hour: undefined, minute: undefined }),
    isExecutionPriority: !!s.isExecutionPriority,
    executionPriorityRank: s.executionPriorityRank,
  })), [pagedCandidates, signalAgeByCode])

  useEffect(() => {
    setPage(1)
  }, [selectedSector])

  const handleConditionFilter = (filter: ConditionFilter) => {
    setConditionFilter(filter)
    setSortKey(FILTER_DEFAULT_SORT[filter])
    setSortDirection('desc')
    setPage(1)
  }

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection(key === 'code' || key === 'name' || key === 'sector_id' ? 'asc' : 'desc')
  }

  const strategyMetricDisplay = useMemo<StrategyMetricSummary[]>(() => {
    if (strategyMetrics.length > 0) return strategyMetrics
    return [
      { key: 'day', label: '데이(당일 시가→종가)', trades: 0, winRatePct: 0, avgReturnPct: 0, bestReturnPct: 0, worstReturnPct: 0, sumReturnPct: 0 },
      { key: 'overnight', label: '오버나이트(당일 종가→익일 시가)', trades: 0, winRatePct: 0, avgReturnPct: 0, bestReturnPct: 0, worstReturnPct: 0, sumReturnPct: 0 },
      { key: 'weekly', label: '주간(당일 종가→5거래일 종가)', trades: 0, winRatePct: 0, avgReturnPct: 0, bestReturnPct: 0, worstReturnPct: 0, sumReturnPct: 0 },
    ]
  }, [strategyMetrics])

  const onStrategyMetricCardClick = (key: StrategyMetricSummary['key']) => {
    const filter = STRATEGY_FILTER_BY_METRIC_KEY[key]
    if (!filter) return
    const recommendedLookback: StrategyLookbackDays = key === 'day' ? 30 : key === 'overnight' ? 60 : 120
    if (strategyLookbackDays !== recommendedLookback) {
      setStrategyLookbackDays(recommendedLookback)
    }
    handleConditionFilter(filter)
    if (key === 'day') {
      setSortKey('intraday_change_pct')
      setSortDirection('desc')
    } else if (key === 'overnight') {
      setSortKey('priority_score')
      setSortDirection('desc')
    } else {
      setSortKey('lead_accumulation_score')
      setSortDirection('desc')
    }
    setPage(1)
  }

  const activeStrategyGuide = useMemo(() => STRATEGY_GUIDE_BY_FILTER[conditionFilter] ?? null, [conditionFilter])

  const getStrategyMetricStatus = useCallback((metric: StrategyMetricSummary) => {
    const recent30 = recent30MetricsMap[metric.key]

    if (metric.trades < 12 && !(recent30 && recent30.trades >= 8)) {
      return {
        label: '데이터부족',
        textColor: 'var(--color-text-secondary)',
        bgColor: 'var(--color-gray-100)',
      }
    }

    // 최근 30일 악화를 우선 감지해 실전 대응 속도를 높인다.
    if (recent30 && recent30.trades >= 8) {
      if (recent30.sumReturnPct < 0 || recent30.avgReturnPct < 0) {
        return {
          label: '경고(최근악화)',
          textColor: 'var(--color-stock-down)',
          bgColor: 'var(--color-stock-down-bg)',
        }
      }
      if (recent30.winRatePct < 48) {
        return {
          label: '주의(최근약화)',
          textColor: 'var(--color-warning)',
          bgColor: 'var(--color-warning-bg)',
        }
      }
    }

    if (metric.sumReturnPct < 0 || metric.avgReturnPct < 0) {
      return {
        label: '경고',
        textColor: 'var(--color-stock-down)',
        bgColor: 'var(--color-stock-down-bg)',
      }
    }
    if (metric.winRatePct < 48) {
      return {
        label: '주의',
        textColor: 'var(--color-warning)',
        bgColor: 'var(--color-warning-bg)',
      }
    }
    return {
      label: '양호',
      textColor: 'var(--color-stock-up)',
      bgColor: 'var(--color-stock-up-bg)',
    }
  }, [recent30MetricsMap])

  const activeStrategyMetric = useMemo(() => {
    if (!activeStrategyMetricKey) return null
    return strategyMetricDisplay.find((metric) => metric.key === activeStrategyMetricKey) ?? null
  }, [activeStrategyMetricKey, strategyMetricDisplay])

  const activeStrategyStatus = useMemo(
    () => (activeStrategyMetric ? getStrategyMetricStatus(activeStrategyMetric) : null),
    [activeStrategyMetric, getStrategyMetricStatus],
  )

  const activeStrategyPositionText = useMemo(() => {
    if (!activeStrategyMetric || !activeStrategyStatus) return null
    const baseR = STRATEGY_BASE_POSITION_R[activeStrategyMetric.key]
    const tier = getStrategyRiskTier(activeStrategyStatus.label)
    const recommendedR = getTierAdjustedPosition(baseR, tier)
    const tierLabel = tier === 'warning' ? '경고 감산 적용' : tier === 'caution' ? '주의 감산 적용' : '양호 유지'
    return `현재 권장 ${formatNumber(recommendedR, 1)}R (${tierLabel})`
  }, [activeStrategyMetric, activeStrategyStatus])

  const activeStrategyCoverage = useMemo(() => {
    if (!activeStrategyMetricKey) return null
    return strategyCoverage?.strategies?.[activeStrategyMetricKey] ?? null
  }, [activeStrategyMetricKey, strategyCoverage])

  const activeStrategyBackfillGuard = useMemo(() => {
    if (!activeStrategyCoverage) return null
    if (activeStrategyCoverage.hasEnoughSamples) return null
    return `백필 필요: 수익 표본 ${activeStrategyCoverage.returnCount}/${activeStrategyCoverage.minRequired}, 커버리지 ${formatNumber(activeStrategyCoverage.coveragePct, 1)}%`
  }, [activeStrategyCoverage])

  const onAddToWatchlist = async (code: string) => {
    try {
      const result = await addToWatchlist(code)
      if (result === 'added') {
        toast.show('관심 종목에 추가되었습니다')
      } else if (result === 'exists') {
        toast.show('이미 관심 종목에 있습니다')
      }
    } catch (e: any) {
      toast.show(String(e?.message || e))
    }
  }

  const onToggleWatchlist = async (e: React.MouseEvent, code: string) => {
    e.stopPropagation()
    if (!code) return
    if (isWatched(code)) {
      try {
        const result = await removeFromWatchlist(code)
        if (result === 'removed' || result === 'not-found') {
          toast.show('관심 종목에서 제거되었습니다')
        }
      } catch (e: any) {
        toast.show(String(e?.message || e))
      }
      return
    }
    await onAddToWatchlist(code)
  }

  const onShareScan = async () => {
    const rows = sortedCandidates.slice(0, 30).map((row) => ({
      code: row.code,
      name: row.name,
      sector: row.sector_id,
      entryGrade: row.entry_grade,
      trendGrade: row.trend_grade,
      distGrade: row.dist_grade,
      pivotGrade: row.pivot_grade,
      warnGrade: row.warn_grade,
      warnScore: row.warn_score,
      entryScore: row.entry_score,
      priorityScore: Number(computePriorityScore(row).toFixed(1)),
      intradayChangePct: typeof row.intraday_change_pct === 'number' ? row.intraday_change_pct : null,
      tradeDate: row.trade_date,
    }))

    await shareManager.createShare('scan', {
      kind: 'scan',
      payload: {
        viewMode: 'table',
        latestDate,
        marketPhase,
        realtimeAppliedCount,
        sectionLabels: {
          highlights: '눌림목(스윙/중기) TOP 카드',
          candidates: '실전 기준 후보 목록',
        },
        conditionFilter,
        conditionFilterLabel: CONDITION_FILTER_LABEL_MAP[conditionFilter] ?? '전체',
        selectedSector,
        sectorLabel: selectedSector === 'all' ? '전체 섹터' : selectedSector,
        rows,
      },
    })
  }

  const renderSortableHeader = (label: string, key: SortKey) => {
    const active = sortKey === key
    const marker = active ? (sortDirection === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />) : null
    return (
      <button
        type="button"
        onClick={() => onSort(key)}
        className={`scan-sort-btn${active ? ' scan-sort-btn--active' : ''}`}
      >
        {label}{marker}
      </button>
    )
  }

  const scan: ScanPanelState = {
    onNavigate,
    candidates,
    total,
    latestDate,
    marketPhase,
    realtimeAppliedCount,
    buycheckMaxHoldings,
    setBuycheckMaxHoldings,
    buycheckHighlightTopN,
    setBuycheckHighlightTopN,
    loading,
    error,
    strategyMetricsLoading,
    strategyLookbackDays,
    setStrategyLookbackDays,
    strategyCoverage,
    strategyCoverageLoading,
    strategyDrilldown,
    strategyDrilldownLoading,
    strategyDrilldownError,
    selectedSector,
    setSelectedSector,
    conditionFilter,
    showAdvancedFilters,
    setShowAdvancedFilters,
    page,
    setPage,
    isMobileViewport,
    pageSize,
    filterChipScrollRef,
    activeStrategyMetricKey,
    isWatched,
    isAdding,
    isRemoving,
    advancedConditionOptions,
    handleFilterChipWheel,
    handleFilterChipKeyDown,
    navigateToAnalyze,
    navigateToExecutionGuide,
    sectors,
    activeHighlights,
    highlightOverlapSet,
    filterCounts,
    confirmPromotionMeta,
    buycheckRiskGuard,
    sortedCandidates,
    totalPages,
    displayRows,
    handleConditionFilter,
    strategyMetricDisplay,
    onStrategyMetricCardClick,
    activeStrategyGuide,
    getStrategyMetricStatus,
    activeStrategyMetric,
    activeStrategyStatus,
    activeStrategyPositionText,
    activeStrategyBackfillGuard,
    onToggleWatchlist,
    renderSortableHeader,
  }

  return (
    <div className="xls-page-inset scan-page">
      <ScanHeader scan={scan} />

      {error && <ErrorState message={error} onRetry={loadCandidates} />}

      <StrategyMetricsPanel scan={scan} />

      <StrategyGuideCard scan={scan} />

      <StrategyDrilldown scan={scan} />

      <HighlightsSection scan={scan} />

      <CandidateTable scan={scan} />
      <ShareModal
        open={shareManager.open}
        onClose={shareManager.close}
        url={shareManager.info?.url}
        code={shareManager.info?.code}
        requiresCode={shareManager.requiresCode}
        expiresAt={shareManager.info?.expiresAt}
        shares={shareManager.list}
        loading={shareManager.loading}
        onRefresh={() => { void shareManager.loadList('scan') }}
        includeAll={shareManager.includeAll}
        onChangeIncludeAll={shareManager.setIncludeAll}
        onRevoke={shareManager.revokeShare}
        revokingId={shareManager.revokingId}
      />
    </div>
  )
}
