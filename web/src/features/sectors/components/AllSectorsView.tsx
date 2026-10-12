import React from "react"
import { SECTOR_META_DATA, NATURE_LABELS, PHASE_LABELS, WICS_ORDER, type SectorNature } from "../sectorMeta"
import { NATURE_COLORS, NATURE_BG, PHASE_COLORS, PHASE_BG } from "../constants"
import type { Sector, SectorLeader } from "../types"
import { formatKoreanMoney } from "../lib/format"
import { ScoreBadge, ChangeRate, NatureBadge } from "./badges"
import { sectorChange } from '../../../lib/sectorDisplay'

export default function AllSectorsView({
  all,
  sectorLeaders,
  leadersLoading,
  leadersError,
  leadersCriteria,
  expandedSectorId,
  onCardClick,
  onNavigateToAnalyze,
}: {
  all: Sector[]
  sectorLeaders: Record<string, SectorLeader[]>
  leadersLoading: boolean
  leadersError: string | null
  leadersCriteria: string
  expandedSectorId: string | null
  onCardClick: (id: string) => void
  onNavigateToAnalyze: (code: string) => void
}) {
  // all 에 없는 섹터는 meta만 있는 더미로 채움 (score=null)
  const nameToSector = new Map<string, Sector>(all.map((s) => [s.name, s]))

  // WICS_ORDER 순서로 그룹화
  const grouped: Record<string, Array<{ sector: Sector | null; meta: (typeof SECTOR_META_DATA)[0] }>> = {}
  for (const meta of SECTOR_META_DATA) {
    const cat = meta.wicsCategory
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push({ sector: nameToSector.get(meta.name) ?? null, meta })
  }

  const orderedCategories = WICS_ORDER.filter((c) => grouped[c])

  return (
    <div>
      <div className="sector-all-legend">
        {(["cyclical", "defensive", "interest_sensitive", "growth"] as SectorNature[]).map((n) => (
          <span key={n} className="sector-nature-badge" style={{ color: NATURE_COLORS[n], background: NATURE_BG[n] }}>
            {NATURE_LABELS[n]}
          </span>
        ))}
      </div>

      {orderedCategories.map((cat) => (
        <div key={cat} className="sector-all-group">
          <div className="sector-all-group-title">{cat}</div>
          <div className="sector-all-grid">
            {grouped[cat].map(({ sector, meta }) => {
              if (!sector) {
                return (
                  <div key={meta.name} className="sector-all-card sector-all-card--no-data">
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-1)" }}>
                      <span className="sector-all-card__name">{meta.name}</span>
                      <NatureBadge nature={meta.nature} />
                    </div>
                    <div className="caption muted">{meta.description}</div>
                  </div>
                )
              }
              const expanded = expandedSectorId === sector.id
              return (
                <div
                  key={sector.id}
                  className={`sector-all-card${expanded ? " sector-all-card--expanded" : ""}`}
                >
                  <button
                    type="button"
                    className="sector-all-card__trigger"
                    onClick={() => onCardClick(sector.id)}
                    aria-expanded={expanded}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-1)", flexWrap: "wrap" }}>
                      <span className="sector-all-card__name">{sector.name}</span>
                      <NatureBadge nature={meta.nature} />
                    </div>
                    <div className="caption muted" style={{ marginBottom: "var(--space-2)" }}>{meta.description}</div>
                    <div className="sector-all-card__footer">
                      <ScoreBadge score={sector.score} />
                      <ChangeRate val={sectorChange(sector)} />
                    </div>
                  </button>
                  {expanded && (
                    <div className="sector-leader-panel" onClick={(e) => e.stopPropagation()}>
                      {meta.favorablePhases.length > 0 && (
                        <div className="sector-cycle-hint" style={{ marginBottom: "var(--space-2)" }}>
                          <span className="sector-cycle-hint__label">유리한 국면</span>
                          {meta.favorablePhases.map((p) => (
                            <span key={p} className="sector-cycle-hint__tag" style={{ color: PHASE_COLORS[p], background: PHASE_BG[p] }}>
                              {PHASE_LABELS[p]}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="sector-leader-title">대장주 TOP 3</div>
                      {leadersLoading ? (
                        <div className="muted">불러오는 중…</div>
                      ) : leadersError ? (
                        <div className="muted">오류: {leadersError}</div>
                      ) : (sectorLeaders[sector.id] ?? []).length === 0 ? (
                        <div className="muted">후보 종목 없음</div>
                      ) : (
                        <div className="sector-leader-list">
                          {(sectorLeaders[sector.id] ?? []).map((leader, li) => (
                            <button
                              key={`${sector.id}-${leader.code}`}
                              type="button"
                              className="sector-leader-item"
                              onClick={() => onNavigateToAnalyze(leader.code)}
                            >
                              <span className="sector-leader-rank">{li + 1}위</span>
                              <span className="sector-leader-name">{leader.name}</span>
                              <span className="sector-leader-code">{leader.code}</span>
                              <span className="sector-leader-score">
                                {leader.market_cap != null ? `${formatKoreanMoney(leader.market_cap)}원` : "-"}
                              </span>
                            </button>
                          ))}
                          <div className="caption muted">기준: {leadersCriteria}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
