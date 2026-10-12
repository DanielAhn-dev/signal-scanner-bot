import React from "react"
import { RefreshCw } from "lucide-react"
import Button from "../../../components/ui/Button"
import { ROTATION_CYCLE, PHASE_LABELS } from "../sectorMeta"
import type { PhaseDetectionResult, Sector, Tab } from "../types"
import { formatKoDateTimeLong } from "../lib/format"
import { isNextCandidate, sortByScore } from "../lib/tabs"
import SheetSectionHeader from "./SheetSectionHeader"

export default function SectorSummaryTable({
  all,
  tab,
  detected,
  latestUpdatedAt,
  onRefresh,
  refreshing,
}: {
  all: Sector[]
  tab: Tab
  detected: PhaseDetectionResult
  latestUpdatedAt: string | null
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const sorted = sortByScore(all)
  const promisingCount = sorted.filter((sector) => (sector.score ?? 0) >= 55).length
  const nextCount = all.filter(isNextCandidate).length
  const topNames = sorted.slice(0, 3).map((sector) => sector.name).join(" · ") || "—"
  const phaseLabel = detected.phase ? PHASE_LABELS[detected.phase] : "판단중"
  const phaseMeta = detected.phase ? ROTATION_CYCLE.find((phase) => phase.phase === detected.phase) : null

  return (
    <div className="xls-scroll-frame sector-sheet__summary-scroll" style={{ ['--xls-table-min-width' as any]: '500px' }}>
    <table className="xls-table sector-sheet__summary-table" style={{ width: "100%", tableLayout: "fixed", minWidth: 500, marginBottom: "var(--space-4)" }}>
      <colgroup>
        <col style={{ width: 96 }} />
        <col />
        <col style={{ width: 96 }} />
        <col />
        <col style={{ width: 96 }} />
        <col />
      </colgroup>
      <tbody>
        <SheetSectionHeader
          label="섹터 요약"
          value={
            <div className="sector-sheet__summary-meta">
              <span className="caption">탭 {tab === "guide" ? "가이드" : tab === "all" ? "전체" : tab === "next" ? "다음" : "상위"} · 전체 {all.length}개</span>
              <div className="sector-sheet__summary-actions">
                <span className="caption muted">마지막 갱신 {formatKoDateTimeLong(latestUpdatedAt)}</span>
                {tab !== "guide" && onRefresh ? (
                  <Button variant="secondary" onClick={onRefresh} disabled={!!refreshing}>
                    {refreshing ? <><RefreshCw size={14} aria-hidden /> 새로고침 중…</> : "새로고침"}
                  </Button>
                ) : null}
              </div>
            </div>
          }
        />
        <tr className="xls-row">
          <td className="xls-cell">현재 국면</td>
          <td className="xls-cell" colSpan={2}>
            <div className="sector-sheet__summary-value">{phaseLabel}</div>
            <div className="sector-sheet__summary-sub">{phaseMeta?.description ?? "국면 신호를 집계 중입니다."}</div>
            <div className="sector-sheet__summary-sub">{detected.reason}</div>
          </td>
          <td className="xls-cell">탭 현황</td>
          <td className="xls-cell" colSpan={2}>
            <div className="sector-sheet__summary-value">상위 {promisingCount} · 다음 {nextCount}</div>
            <div className="sector-sheet__summary-sub">점수와 수급을 함께 반영한 후보군</div>
          </td>
        </tr>
        <tr className="xls-row xls-row--even">
          <td className="xls-cell">상위 섹터</td>
          <td className="xls-cell" colSpan={2}>
            <div className="sector-sheet__summary-value">{topNames}</div>
            <div className="sector-sheet__summary-sub">점수 기준 상위 섹터</div>
          </td>
          <td className="xls-cell" title="확률이 아니라 1·2위 국면 점수 격차와 거시 국면 일치 여부로 만든 판별 강도입니다">판별 강도</td>
          <td className="xls-cell" colSpan={2}>
            <div className="sector-sheet__summary-value">{detected.confidence}% · {detected.confidenceLabel}</div>
            <div className="sector-sheet__summary-sub">{detected.basisLabel}</div>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
  )
}
