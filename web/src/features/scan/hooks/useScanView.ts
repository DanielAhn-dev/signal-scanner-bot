import { useMemo } from 'react'
import { scoreLeadAccumulationCandidate } from '../../../lib/accumulationSignal'
import { formatKstDateTime } from '../../../lib/format'
import { computePriorityScore, computeQuickTradeScore } from '../lib/candidateScore'
import { isBuycheckStage, isCandidateStage, isConfirmStage, isDayStrategyCandidate, isOvernightStrategyCandidate, isQuickTradeCandidate, isQuickTradeLiteCandidate, isWeeklyStrategyCandidate } from '../lib/candidateStage'
import { toComparableValue } from '../lib/sorting'
import type { ConditionFilter, ConfirmPromotionTrendMeta, ScanCandidate, ScanHighlightItem, SignalAgeMeta, SortDirection, SortKey } from '../types'

export function useScanView({
  candidates, selectedSector, conditionFilter, signalAgeByCode, activeHighlights, sortKey, sortDirection, page, pageSize,
  buycheckRiskGuard, buycheckHighlightTopN, confirmPromotionTrend,
}: {
  candidates: ScanCandidate[]
  selectedSector: string
  conditionFilter: ConditionFilter
  signalAgeByCode: Map<string, SignalAgeMeta>
  activeHighlights: ScanHighlightItem[]
  sortKey: SortKey
  sortDirection: SortDirection
  page: number
  pageSize: number
  buycheckRiskGuard: { overLimit: boolean }
  buycheckHighlightTopN: number
  confirmPromotionTrend: ConfirmPromotionTrendMeta | null
}) {
  const sectors = useMemo(
    () => ['all', ...new Set(candidates.map((row) => row.sector_id).filter((v): v is string => !!v))],
    [candidates],
  )

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

  return {
    sectors,
    filterCounts,
    confirmPromotionMeta,
    sortedCandidates,
    totalPages,
    displayRows,
  }
}
