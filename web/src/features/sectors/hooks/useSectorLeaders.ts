import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "../../../lib/api"
import { DEFAULT_LEADERS_CRITERIA, SECTORS_TTL } from "../constants"
import type { Sector, SectorLeader, Tab } from "../types"

/**
 * 섹터별 대장주 지연 조회와 카드 펼침. 상위/다음 탭에서는 보이는 상위 20개 섹터를 한 번에 조회하고,
 * 이미 받은 섹터나 조회 중일 때는 다시 부르지 않는다(`displayed`는 렌더마다 새 배열이라 이 가드에 의존한다).
 */
export function useSectorLeaders(input: { tab: Tab; displayed: Sector[] }) {
  const { tab, displayed } = input
  const [expandedSectorId, setExpandedSectorId] = useState<string | null>(null)
  const [sectorLeaders, setSectorLeaders] = useState<Record<string, SectorLeader[]>>({})
  const [leadersLoading, setLeadersLoading] = useState(false)
  const [leadersError, setLeadersError] = useState<string | null>(null)
  const [leadersCriteria, setLeadersCriteria] = useState<string>(DEFAULT_LEADERS_CRITERIA)

  const loadSectorLeaders = useCallback(async (sectorIds: string[], force = false) => {
    const normalized = Array.from(new Set(sectorIds.map((id) => id.trim()).filter(Boolean))).slice(0, 30)
    const target = force ? normalized : normalized.filter((id) => !sectorLeaders[id])
    if (target.length === 0 || leadersLoading) return
    setLeadersLoading(true)
    setLeadersError(null)
    try {
      const joined = target.join(",")
      const res = await apiFetch(`/api/ui/sector-leaders?sectorIds=${encodeURIComponent(joined)}&limitPerSector=3`, {
        cacheMs: force ? 0 : SECTORS_TTL,
        timeoutMs: 15_000,
      })
      const rows = (res?.data ?? {}) as Record<string, SectorLeader[]>
      setSectorLeaders((prev) => ({ ...prev, ...rows }))
      if (typeof res?.criteria === "string" && res.criteria.trim()) {
        setLeadersCriteria(res.criteria.trim())
      }
    } catch (e: any) {
      setLeadersError(e?.message || String(e))
    } finally {
      setLeadersLoading(false)
    }
  }, [leadersLoading, sectorLeaders])

  const onSectorCardClick = useCallback((sectorId: string) => {
    setExpandedSectorId((prev) => prev === sectorId ? null : sectorId)
    if (!sectorLeaders[sectorId]) {
      void loadSectorLeaders([sectorId])
    }
  }, [loadSectorLeaders, sectorLeaders])

  useEffect(() => {
    if (tab === "promising" || tab === "next") {
      const ids = displayed.slice(0, 20).map((s) => s.id)
      void loadSectorLeaders(ids)
    }
  }, [displayed, loadSectorLeaders, tab])

  return { expandedSectorId, setExpandedSectorId, sectorLeaders, leadersLoading, leadersError, leadersCriteria, onSectorCardClick }
}
