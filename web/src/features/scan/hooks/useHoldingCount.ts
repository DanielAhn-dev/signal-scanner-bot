import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { useSyncedSettings } from '../../../lib/userState'
import type { ConditionFilter } from '../types'

export function useHoldingCount({ conditionFilter }: { conditionFilter: ConditionFilter }) {
  const [holdingCount, setHoldingCount] = useState<number | null>(null)
  const [holdingCountLoading, setHoldingCountLoading] = useState(false)
  const [holdingCountUpdatedAt, setHoldingCountUpdatedAt] = useState<number | null>(null)
  const [buycheckMaxHoldings, setBuycheckMaxHoldings] = useState<number>(8)
  const [buycheckHighlightTopN, setBuycheckHighlightTopN] = useState<number>(5)
  // 마지막 시도 시각. 성공 시각만 보면 조회가 실패할 때 '오래됨' 판정이 풀리지 않아
  // 실패 → 로딩 해제 → 재조회가 끝없이 반복됐다.
  const lastAttemptAtRef = useRef<number | null>(null)

  const loadHoldingCount = useCallback(async () => {
    lastAttemptAtRef.current = Date.now()
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

  useEffect(() => {
    void loadHoldingCount()
  }, [loadHoldingCount])

  useEffect(() => {
    if (conditionFilter !== 'buycheck') return
    const lastAt = Math.max(holdingCountUpdatedAt ?? 0, lastAttemptAtRef.current ?? 0)
    const staleMs = lastAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - lastAt
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

  return {
    holdingCount,
    holdingCountLoading,
    buycheckMaxHoldings,
    setBuycheckMaxHoldings,
    buycheckHighlightTopN,
    setBuycheckHighlightTopN,
    loadHoldingCount,
    buycheckRiskGuard,
  }
}
