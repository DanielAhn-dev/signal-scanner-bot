import React from "react"
import Button from "../../../components/ui/Button"
import Skeleton from "../../../components/Skeleton"
import { getSectorMeta, PHASE_LABELS } from "../sectorMeta"
import { PHASE_COLORS, PHASE_BG } from "../constants"
import { formatKoreanMoney } from "../lib/format"
import { buildMetricsSummary, buildSectorReason } from "../lib/sectorText"
import type { Sector, SectorLeader, Tab } from "../types"
import { ScoreBadge, ChangeRate, NatureBadge } from "./badges"

export default function RankedSectorsTable({
  loading,
  tab,
  displayed,
  expandedSectorId,
  sectorLeaders,
  leadersLoading,
  leadersError,
  leadersCriteria,
  onSectorCardClick,
  navigateToAnalyze,
}: {
  loading: boolean
  tab: Tab
  displayed: Sector[]
  expandedSectorId: string | null
  sectorLeaders: Record<string, SectorLeader[]>
  leadersLoading: boolean
  leadersError: string | null
  leadersCriteria: string
  onSectorCardClick: (id: string) => void
  navigateToAnalyze: (code: string) => void
}) {
  return (
    <div className="xls-scroll-frame sector-sheet__list-scroll" style={{ ['--xls-table-min-width' as any]: '700px' }}>
    <table className="xls-table sector-sheet__table" style={{ width: "100%", tableLayout: "fixed", minWidth: 700, opacity: loading ? 0.6 : 1, transition: "opacity 0.2s" }}>
      <colgroup>
        <col style={{ width: 52 }} />
        <col style={{ width: 220 }} />
        <col style={{ width: 94 }} />
        <col style={{ width: 110 }} />
        <col style={{ width: 90 }} />
        <col style={{ width: 92 }} />
        <col />
        <col style={{ width: 92 }} />
      </colgroup>
      <thead>
        <tr className="xls-header-row">
          <th className="xls-th">순위</th>
          <th className="xls-th">섹터</th>
          <th className="xls-th">성격</th>
          <th className="xls-th">분류</th>
          <th className="xls-th">점수</th>
          <th className="xls-th">등락</th>
          <th className="xls-th">요약</th>
          <th className="xls-th">상세</th>
        </tr>
      </thead>
      <tbody>
        {loading && displayed.length === 0 && (
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={8}><Skeleton lines={2} height={14} /></td>
          </tr>
        )}

        {!loading && displayed.length === 0 && (
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={8} style={{ color: "var(--color-text-tertiary)" }}>데이터 없음</td>
          </tr>
        )}

        {displayed.map((s, idx) => {
          const meta = getSectorMeta(s.name)
          const expanded = expandedSectorId === s.id
          const isEven = idx % 2 === 1
          const metricsSummary = buildMetricsSummary(s)
          const reason = buildSectorReason(s, tab)
          return (
            <React.Fragment key={s.id}>
              <tr className={`xls-row${isEven ? " xls-row--even" : ""}`}>
                <td className="xls-cell sector-sheet__cell-rank">#{idx + 1}</td>
                <td className="xls-cell sector-sheet__cell-name">{s.name}</td>
                <td className="xls-cell">{meta ? <NatureBadge nature={meta.nature} /> : "-"}</td>
                <td className="xls-cell">{meta?.wicsCategory ?? "-"}</td>
                <td className="xls-cell sector-sheet__cell-score"><ScoreBadge score={s.score} /></td>
                <td className="xls-cell sector-sheet__cell-change"><ChangeRate val={s.change_rate} /></td>
                <td className="xls-cell sector-sheet__cell-summary" title={metricsSummary ?? reason}>{metricsSummary ?? reason}</td>
                <td className="xls-cell sector-sheet__cell-action">
                  <Button variant="secondary" onClick={() => onSectorCardClick(s.id)}>
                    {expanded ? "접기" : "상세"}
                  </Button>
                </td>
              </tr>

              {expanded && (
                <tr className={`xls-row sector-sheet__detail-row${isEven ? " xls-row--even" : ""}`}>
                  <td className="xls-cell" colSpan={8}>
                    <div className="sector-sheet__detail-merged">
                      <div className="sector-sheet__detail-reason">{reason}</div>
                      {meta && meta.favorablePhases.length > 0 && (
                        <div className="sector-sheet__detail-phases">
                          <span className="sector-cycle-hint__label">유리한 국면</span>
                          {meta.favorablePhases.map((p) => (
                            <span key={p} className="sector-cycle-hint__tag" style={{ color: PHASE_COLORS[p], background: PHASE_BG[p] }}>
                              {PHASE_LABELS[p]}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="sector-sheet__detail-subtitle">대장주 TOP 3 (기준: 리더플래그 → 시총 → 유동성)</div>

                      {leadersLoading ? (
                        <div className="muted">대장주를 계산하는 중입니다…</div>
                      ) : leadersError ? (
                        <div className="muted">대장주 데이터를 불러오지 못했습니다: {leadersError}</div>
                      ) : (sectorLeaders[s.id] ?? []).length === 0 ? (
                        <div className="muted">현재 섹터에 표시할 후보 종목이 없습니다.</div>
                      ) : (
                        <div className="sector-sheet__leader-grid">
                          {(sectorLeaders[s.id] ?? []).map((leader, leaderIdx) => (
                            <button
                              key={`${s.id}-${leader.code}`}
                              type="button"
                              className="sector-sheet__leader-btn"
                              onClick={() => navigateToAnalyze(leader.code)}
                              title={`${leader.name} 분석으로 이동`}
                            >
                              <span className="sector-leader-rank">{leaderIdx + 1}위</span>
                              <span className="sector-leader-name">{leader.name}</span>
                              <span className="sector-leader-code">{leader.code}</span>
                              <span className="sector-leader-score">시총 {leader.market_cap != null ? `${formatKoreanMoney(leader.market_cap)}원` : "-"}</span>
                            </button>
                          ))}
                          <div className="caption muted">선정 기준: {leadersCriteria}</div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          )
        })}
      </tbody>
    </table>
    </div>
  )
}
