import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { formatNumber } from '../../../lib/format'
import { STRATEGY_BASE_POSITION_R, STRATEGY_GUIDE_BY_FILTER } from '../constants'
import { getStrategyRiskTier, getTierAdjustedPosition } from '../lib/strategyRisk'
import type { ConditionFilter, StrategyCoverageSummary, StrategyDrilldownItem, StrategyLookbackDays, StrategyMetricSummary } from '../types'

export function useStrategyMetrics({ conditionFilter, activeStrategyMetricKey }: { conditionFilter: ConditionFilter; activeStrategyMetricKey: StrategyMetricSummary['key'] | null }) {
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

  const strategyMetricDisplay = useMemo<StrategyMetricSummary[]>(() => {
    if (strategyMetrics.length > 0) return strategyMetrics
    return [
      { key: 'day', label: '데이(당일 시가→종가)', trades: 0, winRatePct: 0, avgReturnPct: 0, bestReturnPct: 0, worstReturnPct: 0, sumReturnPct: 0 },
      { key: 'overnight', label: '오버나이트(당일 종가→익일 시가)', trades: 0, winRatePct: 0, avgReturnPct: 0, bestReturnPct: 0, worstReturnPct: 0, sumReturnPct: 0 },
      { key: 'weekly', label: '주간(당일 종가→5거래일 종가)', trades: 0, winRatePct: 0, avgReturnPct: 0, bestReturnPct: 0, worstReturnPct: 0, sumReturnPct: 0 },
    ]
  }, [strategyMetrics])

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

  return {
    strategyMetrics,
    strategyMetricsLoading,
    strategyLookbackDays,
    setStrategyLookbackDays,
    strategyCoverage,
    strategyCoverageLoading,
    strategyDrilldown,
    strategyDrilldownLoading,
    strategyDrilldownError,
    recent30MetricsMap,
    strategyMetricDisplay,
    activeStrategyGuide,
    getStrategyMetricStatus,
    activeStrategyMetric,
    activeStrategyStatus,
    activeStrategyPositionText,
    activeStrategyCoverage,
    activeStrategyBackfillGuard,
  }
}
