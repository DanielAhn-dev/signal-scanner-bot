import { ArrowDown, ArrowUp } from 'lucide-react'
import { ErrorState } from '../../components/StateViews'
import ShareModal from '../../components/ShareModal'
import ScanHeader from './components/ScanHeader'
import StrategyMetricsPanel from './components/StrategyMetricsPanel'
import StrategyGuideCard from './components/StrategyGuideCard'
import StrategyDrilldown from './components/StrategyDrilldown'
import HighlightsSection from './components/HighlightsSection'
import CandidateTable from './components/CandidateTable'
import type { ScanPanelState, SortKey } from './types'
import { useMobileViewport } from './hooks/useMobileViewport'
import { useScanFilters } from './hooks/useScanFilters'
import { useScanCandidates } from './hooks/useScanCandidates'
import { useHoldingCount } from './hooks/useHoldingCount'
import { useStrategyMetrics } from './hooks/useStrategyMetrics'
import { useScanHighlights } from './hooks/useScanHighlights'
import { useScanView } from './hooks/useScanView'
import { useScanWatchlist } from './hooks/useScanWatchlist'
import { useScanActions } from './hooks/useScanActions'

export default function ScanPage({ onNavigate }: { onNavigate?: (r: string) => void }) {
  // 화면 상태·조건
  const { isMobileViewport } = useMobileViewport()
  const {
    selectedSector, setSelectedSector, conditionFilter, showAdvancedFilters, setShowAdvancedFilters,
    sortKey, setSortKey, sortDirection, setSortDirection, page, setPage, pageSize,
    filterChipScrollRef, activeStrategyMetricKey, advancedConditionOptions,
    handleFilterChipWheel, handleFilterChipKeyDown, handleConditionFilter, onSort,
  } = useScanFilters()

  // 데이터
  const {
    candidates, total, latestDate, marketPhase, realtimeAppliedCount, confirmPromotionTrend,
    loading, error, loadCandidates, signalAgeByCode,
  } = useScanCandidates()
  const {
    holdingCount, holdingCountLoading, buycheckMaxHoldings, setBuycheckMaxHoldings,
    buycheckHighlightTopN, setBuycheckHighlightTopN, loadHoldingCount, buycheckRiskGuard,
  } = useHoldingCount({ conditionFilter })
  const {
    strategyMetrics, strategyMetricsLoading, strategyLookbackDays, setStrategyLookbackDays,
    strategyCoverage, strategyCoverageLoading, strategyDrilldown, strategyDrilldownLoading,
    strategyDrilldownError, recent30MetricsMap, strategyMetricDisplay, activeStrategyGuide,
    getStrategyMetricStatus, activeStrategyMetric, activeStrategyStatus, activeStrategyPositionText,
    activeStrategyCoverage, activeStrategyBackfillGuard,
  } = useStrategyMetrics({ conditionFilter, activeStrategyMetricKey })
  const { apiHighlights, highlightLoading, activeHighlights, highlightOverlapSet } = useScanHighlights({ candidates })

  // 파생값
  const { sectors, filterCounts, confirmPromotionMeta, sortedCandidates, totalPages, displayRows } = useScanView({
    candidates, selectedSector, conditionFilter, signalAgeByCode, activeHighlights, sortKey, sortDirection,
    page, pageSize, buycheckRiskGuard, buycheckHighlightTopN, confirmPromotionTrend,
  })

  // 동작
  const { isWatched, isAdding, isRemoving, onToggleWatchlist } = useScanWatchlist()
  const {
    scanLoading, shareManager, triggerScan, navigateToAnalyze, navigateToExecutionGuide, navigateToBacktest,
    onStrategyMetricCardClick, onShareScan,
  } = useScanActions({
    onNavigate, loadCandidates, loadHoldingCount, strategyLookbackDays, setStrategyLookbackDays, handleConditionFilter,
    setSortKey, setSortDirection, setPage, sortedCandidates, latestDate, marketPhase, realtimeAppliedCount,
    conditionFilter, selectedSector,
  })

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
