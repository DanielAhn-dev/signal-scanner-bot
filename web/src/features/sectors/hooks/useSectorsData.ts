import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { apiFetch } from "../../../lib/api"
import { LS_KEY, SECTORS_TTL } from "../constants"
import { readLS, writeLS } from "../lib/cache"
import { detectCurrentPhase } from "../lib/phase"
import { latestSectorUpdate } from "../lib/tabs"
import type { Sector, SectorMarketOverviewSnapshot } from "../types"

/**
 * 섹터 목록(60초 localStorage 캐시)과 시장 개요 조회. 시장 개요가 실패해도 섹터는 보여준다.
 * 섹터를 캐시로 보여줄 때도 시장 개요는 따로 조회한다 — 예전엔 캐시 경로에서 시장 개요 없이 섹터 점수만으로 국면을 추정했다.
 */
export function useSectorsData() {
  // 첫 렌더에만 캐시를 읽는다(예전엔 렌더마다 localStorage를 읽고 파싱했다)
  const [initAll] = useState<Sector[]>(() => readLS<Sector[]>(LS_KEY, SECTORS_TTL) ?? [])
  const [all, setAll] = useState<Sector[]>(initAll)
  const [loading, setLoading] = useState(initAll.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [marketOverview, setMarketOverview] = useState<SectorMarketOverviewSnapshot | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(initAll.length > 0 ? new Date().toISOString() : null)
  const detected = useMemo(() => detectCurrentPhase(all, marketOverview), [all, marketOverview])
  const latestUpdatedAt = useMemo(() => latestSectorUpdate(all), [all])
  const displayUpdatedAt = latestUpdatedAt ?? lastLoadedAt
  const overviewRequestedRef = useRef(false)

  const loadMarketOverview = useCallback(async () => {
    try {
      const res = await apiFetch("/api/ui/market-overview", { cacheMs: SECTORS_TTL, timeoutMs: 12_000, retries: 0 })
      setMarketOverview(res?.data ?? res ?? null)
    } catch {
      // 시장 개요 실패는 섹터 표시를 막지 않는다
    }
  }, [])

  const loadData = useCallback(async (force = false) => {
    overviewRequestedRef.current = true
    setLoading(true)
    setError(null)
    try {
      const [sectorResult, marketResult] = await Promise.allSettled([
        apiFetch("/api/ui/sectors", { cacheMs: force ? 0 : SECTORS_TTL, timeoutMs: 15_000 }),
        apiFetch("/api/ui/market-overview", { cacheMs: force ? 0 : SECTORS_TTL, timeoutMs: 12_000, retries: 0 }),
      ])
      if (sectorResult.status !== "fulfilled") throw sectorResult.reason
      const data: Sector[] = sectorResult.value?.data ?? []
      setAll(data)
      if (marketResult.status === "fulfilled") {
        const marketData = marketResult.value?.data ?? marketResult.value ?? null
        setMarketOverview(marketData)
      }
      setLastLoadedAt(new Date().toISOString())
      writeLS(LS_KEY, data)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (all.length === 0) {
      loadData()
      return
    }
    setLoading(false)
    if (!overviewRequestedRef.current) {
      overviewRequestedRef.current = true
      void loadMarketOverview()
    }
  }, [loadData, loadMarketOverview, all.length])

  return { all, loading, error, detected, displayUpdatedAt, loadData }
}
