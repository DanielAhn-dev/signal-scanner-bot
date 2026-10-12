import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import type { AutoCycleInsights, OperationsKpi, SellCandidate, TradeRow } from '../types'

/** 운영 패널의 조회 3종(이력·KPI·자동매매 인사이트)과 자동매도 점검(요청 시 조회) */
export function useOperationsData(toast: { show: (message: string) => void }) {
  const [activity, setActivity] = useState<TradeRow[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [dashboardKpi, setDashboardKpi] = useState<OperationsKpi | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [autocycleInsights, setAutocycleInsights] = useState<AutoCycleInsights | null>(null)
  const [autocycleInsightsLoading, setAutocycleInsightsLoading] = useState(true)
  const [sellCandidates, setSellCandidates] = useState<SellCandidate[]>([])
  const [sellLoading, setSellLoading] = useState(false)
  const [sellFetched, setSellFetched] = useState(false)

  const loadActivity = useCallback(async () => {
    setActivityLoading(true)
    try {
      const json = await apiFetch('/api/ui/operations?view=activity', { cacheMs: 0, timeoutMs: 15_000 })
      setActivity(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      toast.show('이력 조회 실패: ' + String(e?.message || e))
    } finally {
      setActivityLoading(false)
    }
  }, [toast])

  useEffect(() => { loadActivity() }, [loadActivity])

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true)
    try {
      const json = await apiFetch('/api/ui/operations?view=dashboard', { cacheMs: 0, timeoutMs: 15_000 })
      setDashboardKpi((json?.data || null) as OperationsKpi | null)
    } catch (e: any) {
      toast.show('운영 KPI 조회 실패: ' + String(e?.message || e))
    } finally {
      setDashboardLoading(false)
    }
  }, [toast])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  const loadAutoCycleInsights = useCallback(async () => {
    setAutocycleInsightsLoading(true)
    try {
      const json = await apiFetch('/api/ui/operations?view=autocycle_insights', { cacheMs: 0, timeoutMs: 15_000 })
      setAutocycleInsights((json?.data || null) as AutoCycleInsights | null)
    } catch (e: any) {
      toast.show('자동매매 인사이트 조회 실패: ' + String(e?.message || e))
    } finally {
      setAutocycleInsightsLoading(false)
    }
  }, [toast])

  useEffect(() => { void loadAutoCycleInsights() }, [loadAutoCycleInsights])

  const fetchSellCandidates = async () => {
    setSellLoading(true)
    setSellFetched(false)
    try {
      const json = await apiFetch('/api/ui/operations?view=autosellcheck', { cacheMs: 0, timeoutMs: 15_000 })
      setSellCandidates(Array.isArray(json?.data) ? json.data : [])
      setSellFetched(true)
    } catch (e: any) {
      toast.show('자동매도 점검 실패: ' + String(e?.message || e))
    } finally {
      setSellLoading(false)
    }
  }

  return {
    activity, activityLoading, loadActivity, dashboardKpi, dashboardLoading, loadDashboard,
    autocycleInsights, autocycleInsightsLoading, loadAutoCycleInsights,
    sellCandidates, sellLoading, sellFetched, fetchSellCandidates,
  }
}
