import React, { useEffect, useState, useCallback, useMemo } from "react"
import { apiFetch } from "../../lib/api"
import Skeleton from "../../components/Skeleton"
import { ErrorState } from "../../components/StateViews"
import EconomicEventBadge from "../../components/EconomicEventBadge"
import SheetHeaderBar from "../../components/SheetHeaderBar"
import { ANALYZE_PENDING_CODE_KEY, DEFAULT_LEADERS_CRITERIA, LS_KEY, SECTORS_TTL } from "./constants"
import type { Sector, SectorLeader, SectorMarketOverviewSnapshot, Tab } from "./types"
import { readLS, writeLS } from "./lib/cache"
import { detectCurrentPhase } from "./lib/phase"
import { latestSectorUpdate, rankSectors } from "./lib/tabs"
import SectorSummaryTable from "./components/SectorSummaryTable"
import AllSectorsView from "./components/AllSectorsView"
import SectorGuideView from "./components/SectorGuideView"
import RankedSectorsTable from "./components/RankedSectorsTable"
import TabBar from "./components/TabBar"

export default function SectorsPage({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const initAll = readLS<Sector[]>(LS_KEY, SECTORS_TTL) ?? []
  const [all, setAll] = useState<Sector[]>(initAll)
  const [loading, setLoading] = useState(initAll.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("promising")
  const [expandedSectorId, setExpandedSectorId] = useState<string | null>(null)
  const [sectorLeaders, setSectorLeaders] = useState<Record<string, SectorLeader[]>>({})
  const [leadersLoading, setLeadersLoading] = useState(false)
  const [leadersError, setLeadersError] = useState<string | null>(null)
  const [leadersCriteria, setLeadersCriteria] = useState<string>(DEFAULT_LEADERS_CRITERIA)
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

  const navigateToAnalyze = useCallback((code: string) => {
    try { sessionStorage.setItem(ANALYZE_PENDING_CODE_KEY, code) } catch { /* ignore */ }
    if (onNavigate) {
      onNavigate("analyze")
      return
    }
    try {
      window.history.pushState({}, "", "/analyze")
      window.dispatchEvent(new PopStateEvent("popstate"))
    } catch { /* ignore */ }
  }, [onNavigate])

  const onSectorCardClick = useCallback((sectorId: string) => {
    setExpandedSectorId((prev) => prev === sectorId ? null : sectorId)
    if (!sectorLeaders[sectorId]) {
      void loadSectorLeaders([sectorId])
    }
  }, [loadSectorLeaders, sectorLeaders])

  // 탭별 정렬/필터
  const { displayed } = rankSectors(all, tab)

  useEffect(() => {
    if (tab === "promising" || tab === "next") {
      const ids = displayed.slice(0, 20).map((s) => s.id)
      void loadSectorLeaders(ids)
    }
  }, [displayed, loadSectorLeaders, tab])

  return (
    <section className="sector-sheet sector-sheet--excel xls-page-inset">
      <div className="sector-head">
        <div className="sector-head-toolbar">
          <SheetHeaderBar
            title="섹터"
            subtitle="경기 국면과 수급을 함께 보고, 상위 섹터를 엑셀 시트처럼 빠르게 훑어보는 화면입니다."
            action={<EconomicEventBadge onNavigateToCalendar={() => onNavigate?.("economy")} />}
            className="sector-title-wrap"
          />
        </div>
      </div>

      <SectorSummaryTable
        all={all}
        tab={tab}
        detected={detected}
        latestUpdatedAt={displayUpdatedAt}
        onRefresh={() => loadData(true)}
        refreshing={loading}
      />

      {loading && all.length > 0 && tab !== "guide" && (
        <div className="muted" style={{ marginBottom: "var(--space-3)", fontSize: "var(--font-size-sm)" }}>
          섹터 데이터를 불러오는 중입니다…
        </div>
      )}

      <TabBar tab={tab} onSelect={(key) => { setTab(key); setExpandedSectorId(null) }} />

      {error && <ErrorState message={error} onRetry={() => loadData(true)} />}

      {/* 탭 설명 */}
      {(tab === "promising" || tab === "next") && (
        <div className="card mb-4 sector-sheet__desc-card" style={{ padding: "var(--space-3) var(--space-4)" }}>
          {tab === "promising" ? (
            <p className="muted" style={{ margin: 0 }}>
              현재 점수 기준 <strong>상위 섹터</strong>입니다. 텔레그램 <code>/섹터</code> 명령과 동일한 데이터입니다.
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              최근 5일 외국인/기관 수급과 단기 등락률을 함께 반영한 <strong>순환매 후보 섹터</strong>입니다. 참고용 — 11년 검증에서 덜 오른 업종을 미리 사는 방식은 평균보다 부진했고, 봇은 이 목록으로 매수하지 않습니다.
            </p>
          )}
        </div>
      )}

      {/* 유망·다음 섹터 */}
      {(tab === "promising" || tab === "next") && (
        <RankedSectorsTable
          loading={loading}
          tab={tab}
          displayed={displayed}
          expandedSectorId={expandedSectorId}
          sectorLeaders={sectorLeaders}
          leadersLoading={leadersLoading}
          leadersError={leadersError}
          leadersCriteria={leadersCriteria}
          onSectorCardClick={onSectorCardClick}
          navigateToAnalyze={navigateToAnalyze}
        />
      )}

      {/* 전체 섹터 */}
      {tab === "all" && (
        loading && all.length === 0 ? (
          <div className="cards-list">
            {[0,1,2,3].map((i) => <div key={i} className="card"><Skeleton lines={3} height={14} /></div>)}
          </div>
        ) : (
          <AllSectorsView
            all={all}
            sectorLeaders={sectorLeaders}
            leadersLoading={leadersLoading}
            leadersError={leadersError}
            leadersCriteria={leadersCriteria}
            expandedSectorId={expandedSectorId}
            onCardClick={onSectorCardClick}
            onNavigateToAnalyze={navigateToAnalyze}
          />
        )
      )}

      {/* 섹터 가이드 */}
      {tab === "guide" && <SectorGuideView detected={detected} />}
    </section>
  )
}
