import type { useShareManager } from '../../hooks/useShareManager'
import type { useToast } from '../../components/ToastProvider'
import type { scoreLeadAccumulationCandidate } from '../../lib/accumulationSignal'

export type MarketPhase = 'intraday' | 'after-close'
export type ConditionFilter =
  | 'all'
  | 'candidate'
  | 'confirm'
  | 'buycheck'
  | 'entry'
  | 'trend'
  | 'accumulation'
  | 'lead'
  | 'accumulation_signal'
  | 'stable'
  | 'quick'
  | 'quick_lite'
  | 'signal_d1'
  | 'signal_d2'
  | 'strategy_day'
  | 'strategy_overnight'
  | 'strategy_weekly'

export type SignalHistoryEntry = {
  seenDates: string[]
  strictQuickDates: string[]
  quickLiteDates: string[]
}

export type SignalHistoryMap = Record<string, SignalHistoryEntry>

export type SignalAgeMeta = {
  strictAgeDays: number | null
  quickLiteAgeDays: number | null
}

export type ConfirmPromotionTrendMeta = {
  latest5AvgRatioPct: number
  previous5AvgRatioPct: number | null
  trendDeltaPct: number | null
  sampleDays: number
  daily: Array<{
    tradeDate: string
    candidateCount: number
    confirmCount: number
    ratioPct: number
  }>
}

export type StrategyMetricSummary = {
  key: 'day' | 'overnight' | 'weekly'
  label: string
  trades: number
  winRatePct: number
  avgReturnPct: number
  bestReturnPct: number
  worstReturnPct: number
  sumReturnPct: number
  recentReturns20?: number[]
}

export type StrategyDrilldownItem = {
  tradeDate: string
  code: string
  name: string
  strategyKey: StrategyMetricSummary['key']
  strategyLabel: string
  returnPct: number | null
  outcomeStatus?: 'realized' | 'pending'
}

export type StrategyCoverageEntry = {
  key: StrategyMetricSummary['key']
  label: string
  signalCount: number
  returnCount: number
  coveragePct: number
  minRequired: number
  hasEnoughSamples: boolean
}

export type StrategyCoverageSummary = {
  lookbackDays: number
  generatedAt: string
  history: {
    signalCount: number
    signalDateCount: number
    signalCodeCount: number
  }
  price: {
    priceRowCount: number
    priceDateCount: number
    priceCodeCount: number
  }
  strategies: Record<StrategyMetricSummary['key'], StrategyCoverageEntry>
  alerts: string[]
  needsBackfill: boolean
}

export type StrategyRiskTier = 'good' | 'caution' | 'warning'

export type StrategyGuide = {
  title: string
  entry: string
  positionSize: string
  holding: string
  stopLoss: string
  takeProfit: string
  forceExit: string
  caution: string
}

export type StrategyLookbackDays = 30 | 60 | 120 | 240

export type SortDirection = 'asc' | 'desc'
export type SortKey =
  | 'code'
  | 'name'
  | 'sector_id'
  | 'priority_score'
  | 'lead_accumulation_score'
  | 'intraday_change_pct'
  | 'entry_grade'
  | 'entry_score'
  | 'trend_grade'
  | 'dist_grade'
  | 'pivot_grade'
  | 'warn_score'
  | 'liquidity'
  | 'trade_date'
  | 'stock_updated_at'

export type ScanCandidate = {
  code: string
  name: string
  sector_id: string | null
  liquidity: number | null
  trade_date: string | null
  stock_updated_at: string | null
  entry_grade: string | null
  entry_score: number | null
  trend_grade: string | null
  dist_grade: string | null
  dist_pct: number | null
  pivot_grade: string | null
  vol_atr_grade: string | null
  warn_grade: string | null
  warn_score: number | null
  intraday_change_pct?: number | null
  current_price?: number | null
  price_source?: 'realtime' | 'close'
  adaptive_adjustment?: number | null
  adaptive_reasons?: string[] | null
  adaptive_score?: number | null
  quick_trade_score?: number | null
  quick_trade_strict?: boolean
  quick_trade_lite?: boolean
  quick_last_signal_date?: string | null
  quick_lite_last_signal_date?: string | null
  quick_signal_age_days?: number | null
  quick_lite_signal_age_days?: number | null
  lead_accumulation_score?: number
  lead_accumulation_stage?: 'none' | 'lead' | 'breakout'
}

export type ScanHighlightItem = {
  code: string
  name: string
  sector_id: string | null
  entry_grade: string | null
  entry_score: number | null
  trend_grade: string | null
  dist_grade: string | null
  pivot_grade: string | null
  warn_grade: string | null
  warn_score: number | null
  signal?: string | null
  stable_turn?: string | null
  total_score?: number | null
  highlight_score?: number
  leadAccumulationStage?: 'none' | 'lead' | 'breakout'
  leadAccumulationScore?: number
  isAccumulationSignal?: boolean
  adaptive_adjustment?: number | null
  adaptive_reasons?: string[] | null
  adaptive_score?: number | null
}

/** 표 한 줄에 그리는 값: 후보 원본 + 화면용 계산값(전략 라벨, 점수, 날짜 문구, 집행 우선 순위) */
export type ScanDisplayRow = ScanCandidate & {
  strategyLabel: '데이' | '오버나이트' | '주간' | '관찰'
  priorityScore: number
  quickTradeScore: number
  leadAccumulationScore: number
  leadAccumulationStage: ReturnType<typeof scoreLeadAccumulationCandidate>['stage']
  quickLiteAgeDays: number | null
  intradayChangePct: number | null
  tradeDateText: string
  updatedAtText: string | null
  updatedDateText: string
  isExecutionPriority: boolean
  executionPriorityRank: number | null
  /** 표 행에서는 계산하지 않는다(TOP 카드 항목에서만 채워진다) — 아래 CandidateTable의 배지 조건은 현재 항상 거짓 */
  isAccumulationSignal?: boolean
}

/** 스캔 화면 컴포넌트들이 함께 쓰는 상태·파생값·핸들러 묶음(각 컴포넌트는 필요한 키만 골라 받는다) */
export type ScanPanelState = {
  onNavigate?: (route: string) => void
  candidates: ScanCandidate[]
  total: number
  latestDate: string | null
  marketPhase: MarketPhase
  realtimeAppliedCount: number
  buycheckMaxHoldings: number
  setBuycheckMaxHoldings: (v: number) => void
  buycheckHighlightTopN: number
  setBuycheckHighlightTopN: (v: number) => void
  loading: boolean
  error: string | null
  strategyMetricsLoading: boolean
  strategyLookbackDays: StrategyLookbackDays
  setStrategyLookbackDays: (v: StrategyLookbackDays) => void
  strategyCoverage: StrategyCoverageSummary | null
  strategyCoverageLoading: boolean
  strategyDrilldown: StrategyDrilldownItem[]
  strategyDrilldownLoading: boolean
  strategyDrilldownError: string | null
  selectedSector: string
  setSelectedSector: (v: string) => void
  conditionFilter: ConditionFilter
  showAdvancedFilters: boolean
  setShowAdvancedFilters: React.Dispatch<React.SetStateAction<boolean>>
  page: number
  setPage: (v: number) => void
  isMobileViewport: boolean
  pageSize: number
  filterChipScrollRef: React.MutableRefObject<HTMLDivElement | null>
  activeStrategyMetricKey: StrategyMetricSummary['key'] | null
  isWatched: (code: string) => boolean
  isAdding: (code: string) => boolean
  isRemoving: (code: string) => boolean
  advancedConditionOptions: Array<{ key: ConditionFilter; label: string; advanced?: boolean }>
  handleFilterChipWheel: (event: React.WheelEvent<HTMLDivElement>) => void
  handleFilterChipKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  navigateToAnalyze: (code: string) => void
  navigateToExecutionGuide: (code: string) => void
  sectors: string[]
  activeHighlights: ScanHighlightItem[]
  highlightOverlapSet: Set<string>
  filterCounts: Record<ConditionFilter, number>
  confirmPromotionMeta: { base: number; promoted: number; ratioPct: number; latest5AvgRatioPct: number | null; trendDeltaPct: number | null; trendSampleDays: number; recentRatios: number[] }
  buycheckRiskGuard: { label: string; overLimit: boolean; recommendedMax: number; remainingSlots: number | null }
  sortedCandidates: ScanCandidate[]
  totalPages: number
  displayRows: ScanDisplayRow[]
  handleConditionFilter: (filter: ConditionFilter) => void
  strategyMetricDisplay: StrategyMetricSummary[]
  onStrategyMetricCardClick: (key: StrategyMetricSummary['key']) => void
  activeStrategyGuide: StrategyGuide | null
  getStrategyMetricStatus: (metric: StrategyMetricSummary) => { label: string; textColor: string; bgColor: string }
  activeStrategyMetric: StrategyMetricSummary | null
  activeStrategyStatus: { label: string; textColor: string; bgColor: string } | null
  activeStrategyPositionText: string | null
  activeStrategyBackfillGuard: string | null
  onToggleWatchlist: (e: React.MouseEvent, code: string) => Promise<void>
  renderSortableHeader: (label: string, key: SortKey) => React.ReactNode
}
