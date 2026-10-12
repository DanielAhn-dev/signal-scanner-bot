import { useCallback, useEffect, useMemo, useState } from "react"
import { apiFetch } from "../../../lib/api"
import { LS_KEY, SECTORS_TTL } from "../constants"
import { readLS, writeLS } from "../lib/cache"
import { detectCurrentPhase } from "../lib/phase"
import { latestSectorUpdate } from "../lib/tabs"
import type { Sector, SectorMarketOverviewSnapshot } from "../types"

/** 섹터 목록(60초 localStorage 캐시)과 시장 개요 조회. 시장 개요가 실패해도 섹터는 보여준다. */
export function useSectorsData() {
  const initAll = readLS<Sector[]>(LS_KEY, SECTORS_TTL) ?? []
  const [all, setAll] = useState<Sector[]>(initAll)
  const [loading, setLoading] = useState(initAll.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [marketOverview, setMarketOverview] = useState<SectorMarketOverviewSnapshot | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(initAll.length > 0 ? new Date().toISOString() : null)
  const detected = useMemo(() => detectCurrentPhase(all, marketOverview), [all, marketOverview])
  const latestUpdatedAt = useMemo(() => latestSectorUpdate(all), [all])
  const displayUpdatedAt = latestUpdatedAt ?? lastLoadedAt

  const loadData = useCallback(async (force = false) => {
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
    if (all.length === 0) loadData()
    else setLoading(false)
  }, [loadData, all.length])

  return { all, loading, error, detected, displayUpdatedAt, loadData }
}
