import React, { useCallback, useState } from "react"
import Skeleton from "../../components/Skeleton"
import { ErrorState } from "../../components/StateViews"
import EconomicEventBadge from "../../components/EconomicEventBadge"
import SheetHeaderBar from "../../components/SheetHeaderBar"
import { ANALYZE_PENDING_CODE_KEY } from "./constants"
import type { Tab } from "./types"
import { rankSectors } from "./lib/tabs"
import { useSectorLeaders } from "./hooks/useSectorLeaders"
import { useSectorsData } from "./hooks/useSectorsData"
import SectorSummaryTable from "./components/SectorSummaryTable"
import AllSectorsView from "./components/AllSectorsView"
import SectorGuideView from "./components/SectorGuideView"
import RankedSectorsTable from "./components/RankedSectorsTable"
import TabBar from "./components/TabBar"

export default function SectorsPage({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const [tab, setTab] = useState<Tab>("promising")
  // 훅 호출 순서 = 효과 실행 순서: 섹터 조회(마운트) → 대장주 지연 조회
  const { all, loading, error, detected, displayUpdatedAt, loadData } = useSectorsData()
  // 탭별 정렬/필터
  const { displayed } = rankSectors(all, tab)
  const { expandedSectorId, setExpandedSectorId, sectorLeaders, leadersLoading, leadersError, leadersCriteria, onSectorCardClick } =
    useSectorLeaders({ tab, displayed })

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
