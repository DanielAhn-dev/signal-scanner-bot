import { useMemo } from 'react'
import { useShareManager } from '../../../hooks/useShareManager'
import type { OhlcvCandle } from '../../../lib/types'
import { defaultPlanItem, readSimulationPlan, saveSimulationPlan } from '../../simulator/planStore'
import { EXECUTION_GUIDE_PENDING_KEY } from '../constants'
import { buildShareSummaryLines } from '../lib/shareSummary'

/** 분석 결과에서 이어지는 동작: 시뮬레이터에 추가, 실행가이드로 보내기, 링크 공유 */
export function useAnalyzeActions(input: {
  result: any
  advisor: any
  candles: OhlcvCandle[]
  query: string
  toast: { show: (message: string) => void }
  onNavigate?: (route: string) => void
}) {
  const { result, advisor, candles, query, toast, onNavigate } = input

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

  const shareSummaryLines = useMemo(() => buildShareSummaryLines(result, advisor), [advisor, result])

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

  return { shareManager, addResultToSimulator, sendResultToExecutionGuide, onShareAnalyze }
}
