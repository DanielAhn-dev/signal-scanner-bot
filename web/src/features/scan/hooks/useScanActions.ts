import { useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { useToast } from '../../../components/ToastProvider'
import { useShareManager } from '../../../hooks/useShareManager'
import { ANALYZE_PENDING_CODE_KEY, CONDITION_FILTER_LABEL_MAP, EXECUTION_GUIDE_PENDING_KEY, STRATEGY_FILTER_BY_METRIC_KEY } from '../constants'
import { computePriorityScore } from '../lib/candidateScore'
import type { ConditionFilter, MarketPhase, ScanCandidate, SortDirection, SortKey, StrategyLookbackDays, StrategyMetricSummary } from '../types'

export function useScanActions({
  onNavigate, loadCandidates, loadHoldingCount, strategyLookbackDays, setStrategyLookbackDays, handleConditionFilter,
  setSortKey, setSortDirection, setPage, sortedCandidates, latestDate, marketPhase, realtimeAppliedCount, conditionFilter, selectedSector,
}: {
  onNavigate?: (route: string) => void
  loadCandidates: (options?: { silent?: boolean }) => Promise<void>
  loadHoldingCount: () => Promise<void>
  strategyLookbackDays: StrategyLookbackDays
  setStrategyLookbackDays: (v: StrategyLookbackDays) => void
  handleConditionFilter: (filter: ConditionFilter) => void
  setSortKey: (key: SortKey) => void
  setSortDirection: (dir: SortDirection) => void
  setPage: (page: number) => void
  sortedCandidates: ScanCandidate[]
  latestDate: string | null
  marketPhase: MarketPhase
  realtimeAppliedCount: number
  conditionFilter: ConditionFilter
  selectedSector: string
}) {
  const toast = useToast()

  const [scanLoading, setScanLoading] = useState(false)

  const shareManager = useShareManager({
    endpoint: '/api/ui/route-share',
    scopeKey: 'kind',
    requiresCode: false,
  })

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

  return {
    scanLoading,
    shareManager,
    triggerScan,
    navigateToAnalyze,
    navigateToExecutionGuide,
    navigateToBacktest,
    onStrategyMetricCardClick,
    onShareScan,
  }
}
