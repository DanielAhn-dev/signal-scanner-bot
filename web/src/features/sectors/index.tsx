import React, { useEffect, useState, useCallback, useMemo } from "react"
import { apiFetch } from "../../lib/api"
import Button from "../../components/ui/Button"
import Skeleton from "../../components/Skeleton"
import { ErrorState } from "../../components/StateViews"
import EconomicEventBadge from "../../components/EconomicEventBadge"
import SheetHeaderBar from "../../components/SheetHeaderBar"
import {
  SECTOR_META_DATA,
  ROTATION_CYCLE,
  MACRO_SENSITIVITY,
  getSectorMeta,
  NATURE_LABELS,
  PHASE_LABELS,
  WICS_ORDER,
  type SectorNature,
  type EconomicPhase,
} from "./sectorMeta"

const SECTORS_TTL = 60_000
const LS_KEY = "ls_sectors_page"

function readLS<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p?.ts && Date.now() - p.ts < ttl) return p.data as T
  } catch { /* ignore */ }
  return null
}
function writeLS(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })) } catch { /* ignore */ }
}

type Sector = {
  id: string
  name: string
  score: number | null
  change_rate: number | null
  updated_at?: string | null
  metrics?: Record<string, any>
}

type SectorLeader = {
  code: string
  name: string
  market: string | null
  market_cap: number | null
  liquidity: number | null
  is_sector_leader: boolean | null
}

type Tab = "promising" | "next" | "all" | "guide"

const ANALYZE_PENDING_CODE_KEY = "analyze_pending_code"

// 현재 경기 국면 자동 추정 — WICS 대분류별 평균 점수로 가장 강한 로테이션 단계 판정
function detectCurrentPhase(all: Sector[]): EconomicPhase | null {
  if (all.length === 0) return null
  const catScores: Record<string, number[]> = {}
  for (const s of all) {
    const meta = getSectorMeta(s.name)
    if (!meta || s.score == null) continue
    if (!catScores[meta.wicsCategory]) catScores[meta.wicsCategory] = []
    catScores[meta.wicsCategory].push(s.score)
  }
  const avg = (cats: string[]): number => {
    const scores = cats.flatMap((c) => catScores[c] ?? [])
    if (scores.length === 0) return 0
    return scores.reduce((a, b) => a + b, 0) / scores.length
  }
  const ranked = ROTATION_CYCLE.map((p) => ({ phase: p.phase, score: avg(p.sectorCategories) }))
    .sort((a, b) => b.score - a.score)
  return ranked[0].score > 0 ? ranked[0].phase : null
}

function toNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function formatKoreanMoney(v: number): string {
  const sign = v < 0 ? "-" : ""
  const abs = Math.abs(v)
  const units = [
    { value: 1_0000_0000_0000, label: "조" },
    { value: 1_0000_0000, label: "억" },
    { value: 1_0000, label: "만" },
  ]
  for (const u of units) {
    if (abs >= u.value) {
      const q = abs / u.value
      const digits = q >= 100 ? 0 : q >= 10 ? 1 : 2
      return `${sign}${q.toFixed(digits)}${u.label}`
    }
  }
  return `${sign}${Math.round(abs).toLocaleString()}`
}

function buildMetricsSummary(s: Sector): string | null {
  const core = toNum(s.metrics?.core_count)
  const stock = toNum(s.metrics?.stock_count)
  const inst5d = toNum(s.metrics?.flow_inst_5d)
  const parts: string[] = []
  if (core != null) parts.push(`핵심 ${Math.round(core)}종목`)
  if (stock != null) parts.push(`전체 ${Math.round(stock)}종목`)
  if (inst5d != null) {
    const dir = inst5d > 0 ? "기관↑" : inst5d < 0 ? "기관↓" : "기관-"
    parts.push(`${dir} ${formatKoreanMoney(inst5d)}원`)
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

function buildSectorReason(s: Sector, tab: Tab): string {
  const score = s.score ?? 0
  const change = s.change_rate ?? 0
  const inst5d = toNum(s.metrics?.flow_inst_5d)
  const scoreText = score >= 75
    ? "점수 상위권으로 주도 강도가 높은 구간입니다"
    : score >= 55
      ? "점수가 기준선(55점) 이상이라 추세가 유지되는 구간입니다"
      : "점수는 낮지만 단기 모멘텀을 체크할 구간입니다"

  const changeText = change > 0
    ? `단기 등락률이 +${change.toFixed(2)}%로 우상향 흐름입니다`
    : change < 0
      ? `단기 등락률이 ${change.toFixed(2)}%로 변동성 확인이 필요합니다`
      : "단기 등락률은 보합권입니다"

  const flowText = inst5d == null
    ? "수급 데이터는 제한적으로 제공됩니다"
    : inst5d > 0
      ? `기관 수급이 최근 5일 ${formatKoreanMoney(inst5d)}원 순유입입니다`
      : inst5d < 0
        ? `기관 수급이 최근 5일 ${formatKoreanMoney(Math.abs(inst5d))}원 순유출입니다`
        : "기관 수급이 최근 5일 중립입니다"

  if (tab === "promising") return `${scoreText}. ${flowText}.`
  return `${changeText}. ${flowText}.`
}

function formatKoDateTime(value?: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatKoDateTimeLong(value?: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="caption">-</span>
  const s = Math.round(score)
  const color = s >= 75 ? "var(--color-stock-up)" : s >= 55 ? "var(--color-brand)" : "var(--color-text-tertiary)"
  return (
    <span style={{ fontWeight: 700, color, fontSize: "var(--font-size-xl)" }}>
      {s}<span style={{ fontSize: "var(--font-size-xs)", fontWeight: 400, color: "var(--color-text-tertiary)", marginLeft: 2 }}>점</span>
    </span>
  )
}

function ChangeRate({ val }: { val: number | null }) {
  if (val == null) return <span className="muted">-</span>
  const cls = val > 0 ? "positive" : val < 0 ? "negative" : "neutral"
  return <span className={cls}>{val > 0 ? "+" : ""}{val.toFixed(2)}%</span>
}

const NATURE_COLORS: Record<SectorNature, string> = {
  cyclical:           "var(--color-orange-500)",
  defensive:          "var(--color-green-500)",
  interest_sensitive: "var(--color-brand)",
  growth:             "#9B59B6",
}
const NATURE_BG: Record<SectorNature, string> = {
  cyclical:           "rgba(255,107,53,0.1)",
  defensive:          "rgba(0,180,147,0.1)",
  interest_sensitive: "rgba(0,96,255,0.1)",
  growth:             "rgba(155,89,182,0.1)",
}

function NatureBadge({ nature }: { nature: SectorNature }) {
  return (
    <span className="sector-nature-badge" style={{ color: NATURE_COLORS[nature], background: NATURE_BG[nature] }}>
      {NATURE_LABELS[nature]}
    </span>
  )
}

const PHASE_COLORS: Record<EconomicPhase, string> = {
  recovery:  "var(--color-green-500)",
  expansion: "var(--color-brand)",
  slowdown:  "var(--color-orange-500)",
  recession: "var(--color-red-500, #F04452)",
}
const PHASE_BG: Record<EconomicPhase, string> = {
  recovery:  "rgba(0,180,147,0.08)",
  expansion: "rgba(0,96,255,0.08)",
  slowdown:  "rgba(255,107,53,0.08)",
  recession: "rgba(240,68,82,0.08)",
}

// ── 섹터 카드 (유망/다음 탭 공통) ────────────────────────────────────────

interface SectorCardProps {
  s: Sector
  idx: number
  tab: Tab
  expanded: boolean
  leaders: SectorLeader[] | undefined
  leadersLoading: boolean
  leadersError: string | null
  leadersCriteria: string
  onCardClick: (id: string) => void
  onNavigateToAnalyze: (code: string) => void
}

function SectorCard({
  s, idx, tab, expanded, leaders, leadersLoading, leadersError, leadersCriteria, onCardClick, onNavigateToAnalyze,
}: SectorCardProps) {
  const meta = getSectorMeta(s.name)
  const metricsSummary = buildMetricsSummary(s)
  const reason = buildSectorReason(s, tab)

  return (
    <div className={`card sector-row-card${expanded ? " sector-row-card--expanded" : ""}`}>
      <button
        type="button"
        className="sector-row-trigger"
        onClick={() => onCardClick(s.id)}
        aria-expanded={expanded}
      >
        <div className="sector-row-left">
          <div className="sector-row-rank">#{idx + 1}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <span className="sector-row-name">{s.name}</span>
              {meta && <NatureBadge nature={meta.nature} />}
            </div>
            {metricsSummary && (
              <div className="sector-row-meta">
                <span className="caption">{metricsSummary}</span>
              </div>
            )}
            <p className="muted" style={{ margin: "6px 0 0", lineHeight: 1.45 }}>{reason}</p>
          </div>
        </div>
        <div className="sector-row-right">
          <ScoreBadge score={s.score} />
          <ChangeRate val={s.change_rate} />
        </div>
      </button>

      {expanded && (
        <div className="sector-leader-panel" onClick={(e) => e.stopPropagation()}>
          {meta && meta.favorablePhases.length > 0 && (
            <div className="sector-cycle-hint">
              <span className="sector-cycle-hint__label">유리한 국면</span>
              {meta.favorablePhases.map((p) => (
                <span key={p} className="sector-cycle-hint__tag" style={{ color: PHASE_COLORS[p], background: PHASE_BG[p] }}>
                  {PHASE_LABELS[p]}
                </span>
              ))}
              {meta.description && <span className="caption muted">{meta.description}</span>}
            </div>
          )}
          <div className="sector-leader-title">대장주 TOP 3 (기준: 리더플래그 → 시총 → 유동성)</div>
          {leadersLoading ? (
            <div className="muted">대장주를 계산하는 중입니다…</div>
          ) : leadersError ? (
            <div className="muted">대장주 데이터를 불러오지 못했습니다: {leadersError}</div>
          ) : (leaders ?? []).length === 0 ? (
            <div className="muted">현재 섹터에 표시할 후보 종목이 없습니다.</div>
          ) : (
            <div className="sector-leader-list">
              {(leaders ?? []).map((leader, leaderIdx) => (
                <button
                  key={`${s.id}-${leader.code}`}
                  type="button"
                  className="sector-leader-item"
                  onClick={() => onNavigateToAnalyze(leader.code)}
                  title={`${leader.name} 분석으로 이동`}
                >
                  <span className="sector-leader-rank">{leaderIdx + 1}위</span>
                  <span className="sector-leader-name">{leader.name}</span>
                  <span className="sector-leader-code">{leader.code}</span>
                  <span className="sector-leader-score">
                    시총 {leader.market_cap != null ? `${formatKoreanMoney(leader.market_cap)}원` : "-"}
                  </span>
                </button>
              ))}
              <div className="caption muted">선정 기준: {leadersCriteria}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SectorSummaryTable({
  all,
  tab,
  detectedPhase,
  latestUpdatedAt,
  onRefresh,
  refreshing,
}: {
  all: Sector[]
  tab: Tab
  detectedPhase: EconomicPhase | null
  latestUpdatedAt: string | null
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const sorted = [...all].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const promisingCount = sorted.filter((sector) => (sector.score ?? 0) >= 55).length
  const nextCount = all.filter((sector) => {
    const flow5d = (toNum(sector.metrics?.flow_foreign_5d) ?? 0) + (toNum(sector.metrics?.flow_inst_5d) ?? 0)
    return flow5d > 0 || ((sector.change_rate ?? 0) > 0 && (sector.score ?? 0) >= 40)
  }).length
  const topNames = sorted.slice(0, 3).map((sector) => sector.name).join(" · ") || "—"
  const phaseLabel = detectedPhase ? PHASE_LABELS[detectedPhase] : "판단중"
  const phaseMeta = detectedPhase ? ROTATION_CYCLE.find((phase) => phase.phase === detectedPhase) : null

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
              <span className="caption">탭 {tab === "guide" ? "가이드" : tab === "all" ? "전체" : tab === "next" ? "다음" : "유망"} · 전체 {all.length}개</span>
              <div className="sector-sheet__summary-actions">
                <span className="caption muted">마지막 갱신 {formatKoDateTimeLong(latestUpdatedAt)}</span>
                {tab !== "guide" && onRefresh ? (
                  <Button variant="secondary" onClick={onRefresh} disabled={!!refreshing}>
                    {refreshing ? "⟳ 새로고침 중…" : "새로고침"}
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
            <div className="sector-sheet__summary-sub">{phaseMeta?.description ?? "섹터 점수 기반으로 경기 국면을 추정합니다."}</div>
          </td>
          <td className="xls-cell">탭 현황</td>
          <td className="xls-cell" colSpan={2}>
            <div className="sector-sheet__summary-value">유망 {promisingCount} · 다음 {nextCount}</div>
            <div className="sector-sheet__summary-sub">점수와 수급을 함께 반영한 후보군</div>
          </td>
        </tr>
        <tr className="xls-row xls-row--even">
          <td className="xls-cell">상위 섹터</td>
          <td className="xls-cell" colSpan={2}>
            <div className="sector-sheet__summary-value">{topNames}</div>
            <div className="sector-sheet__summary-sub">점수 기준 상위 섹터</div>
          </td>
          <td className="xls-cell">가이드</td>
          <td className="xls-cell" colSpan={2}>
            <div className="sector-sheet__summary-value">로테이션 추적</div>
            <div className="sector-sheet__summary-sub">경기 국면에 맞는 섹터를 우선 확인</div>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
  )
}

function SheetSectionHeader({
  label,
  value,
  colSpan = 6,
  onClick,
}: {
  label: string
  value?: React.ReactNode
  colSpan?: number
  onClick?: () => void
}) {
  const clickable = typeof onClick === "function"
  return (
    <tr className={`xls-row xls-row--even${clickable ? " sector-sheet__section-row--clickable" : ""}`} onClick={onClick}>
      <td className="xls-cell" colSpan={colSpan}>
        <div className="sector-sheet__section-row-inner">
          <span className="sector-sheet__section-label-inline">{label}</span>
          {value ? <div className="sector-sheet__section-action">{value}</div> : null}
        </div>
      </td>
    </tr>
  )
}

// ── 전체 섹터 탭 ─────────────────────────────────────────────────────────

function AllSectorsView({
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
                      <ChangeRate val={sector.change_rate} />
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

// ── 섹터 가이드 탭 ───────────────────────────────────────────────────────

function SectorGuideView({ detectedPhase }: { detectedPhase: EconomicPhase | null }) {
  const activePhaseData = detectedPhase ? ROTATION_CYCLE.find((p) => p.phase === detectedPhase) : null

  return (
    <div className="sector-guide">

      {/* 현재 추정 국면 배너 */}
      {activePhaseData && (
        <div
          className="sector-phase-banner"
          style={{
            borderColor: PHASE_COLORS[activePhaseData.phase],
            background: PHASE_BG[activePhaseData.phase],
          }}
        >
          <div className="sector-phase-banner__left">
            <span className="sector-phase-banner__emoji">{activePhaseData.emoji}</span>
            <div>
              <div className="sector-phase-banner__label">
                현재 추정 국면
                <span className="sector-phase-banner__phase" style={{ color: PHASE_COLORS[activePhaseData.phase] }}>
                  {activePhaseData.label}
                </span>
              </div>
              <div className="caption muted">
                섹터 점수 기반 자동 추정 — 주도 섹터 범주: {activePhaseData.sectorCategories.join(" · ")}
              </div>
            </div>
          </div>
          <div className="caption muted sector-phase-banner__note">참고용 · 실제 국면과 다를 수 있음</div>
        </div>
      )}

      {/* 섹터 로테이션 사이클 */}
      <section className="sector-guide-section">
        <h2 className="sector-guide-section__title">섹터 로테이션 사이클</h2>
        <p className="muted" style={{ marginBottom: "var(--space-4)", lineHeight: 1.6 }}>
          경기는 네 국면을 반복하며 순환합니다. 국면마다 강세를 보이는 섹터가 다르므로,
          현재 경기 위치를 파악하고 유리한 섹터로 자금을 이동하는 것이 섹터 로테이션 전략입니다.
        </p>

        {/* 사이클 플로우 — 데스크탑 가로 */}
        <div className="rotation-flow">
          {ROTATION_CYCLE.map((phase, idx) => {
            const isActive = detectedPhase === phase.phase
            return (
              <React.Fragment key={phase.phase}>
                <div
                  className={`rotation-phase-card${isActive ? " rotation-phase-card--active" : ""}`}
                  style={{
                    borderColor: PHASE_COLORS[phase.phase],
                    "--phase-color": PHASE_COLORS[phase.phase],
                    background: isActive ? PHASE_BG[phase.phase] : undefined,
                  } as React.CSSProperties}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span className="rotation-phase-card__emoji">{phase.emoji}</span>
                    {isActive && <span className="rotation-phase-card__now-badge">현재</span>}
                  </div>
                  <div className="rotation-phase-card__label" style={{ color: PHASE_COLORS[phase.phase] }}>
                    {phase.label}
                  </div>
                  <p className="rotation-phase-card__desc">{phase.description}</p>
                  <div className="rotation-phase-card__sectors">
                    {phase.sectorCategories.map((sc) => (
                      <span key={sc} className="rotation-phase-card__sector-tag" style={{ color: PHASE_COLORS[phase.phase], background: PHASE_BG[phase.phase] }}>
                        {sc}
                      </span>
                    ))}
                  </div>
                  <div className="rotation-phase-card__indicators">
                    {phase.indicators.map((ind) => (
                      <div key={ind} className="caption muted rotation-phase-card__indicator">· {ind}</div>
                    ))}
                  </div>
                </div>
                {idx < ROTATION_CYCLE.length - 1 && (
                  <div className="rotation-arrow">→</div>
                )}
                {idx === ROTATION_CYCLE.length - 1 && (
                  <div className="rotation-arrow rotation-arrow--loop">↩</div>
                )}
              </React.Fragment>
            )
          })}
        </div>

        {/* 모바일: 수직 플로우 */}
        <div className="rotation-flow-vertical">
          {ROTATION_CYCLE.map((phase, idx) => {
            const isActive = detectedPhase === phase.phase
            return (
              <div key={phase.phase} className="rotation-flow-vertical__item">
                <div className="rotation-flow-vertical__connector">
                  <div
                    className="rotation-flow-vertical__dot"
                    style={{ background: PHASE_COLORS[phase.phase], boxShadow: isActive ? `0 0 0 3px ${PHASE_BG[phase.phase]}` : undefined }}
                  />
                  {idx < ROTATION_CYCLE.length - 1 && <div className="rotation-flow-vertical__line" />}
                </div>
                <div
                  className={`rotation-phase-card rotation-phase-card--vertical${isActive ? " rotation-phase-card--active" : ""}`}
                  style={{ borderColor: PHASE_COLORS[phase.phase], background: isActive ? PHASE_BG[phase.phase] : undefined }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)", flexWrap: "wrap" }}>
                    <span className="rotation-phase-card__emoji" style={{ fontSize: "1.1rem" }}>{phase.emoji}</span>
                    <span className="rotation-phase-card__label" style={{ color: PHASE_COLORS[phase.phase] }}>{phase.label}</span>
                    {isActive && <span className="rotation-phase-card__now-badge">현재</span>}
                    <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap", marginLeft: "auto" }}>
                      {phase.sectorCategories.map((sc) => (
                        <span key={sc} className="rotation-phase-card__sector-tag" style={{ color: PHASE_COLORS[phase.phase], background: PHASE_BG[phase.phase] }}>
                          {sc}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="rotation-phase-card__desc">{phase.description}</p>
                  <div className="rotation-phase-card__indicators" style={{ marginTop: "var(--space-1)" }}>
                    {phase.indicators.map((ind) => (
                      <span key={ind} className="caption muted rotation-phase-card__indicator">· {ind}　</span>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
          <div className="rotation-flow-vertical__item">
            <div className="rotation-flow-vertical__connector">
              <div className="rotation-flow-vertical__dot" style={{ background: PHASE_COLORS["recovery"] }} />
            </div>
            <div className="caption muted" style={{ paddingTop: 4 }}>↩ 다시 회복기로 반복</div>
          </div>
        </div>
      </section>

      {/* 경기민감 vs 방어주 */}
      <section className="sector-guide-section">
        <h2 className="sector-guide-section__title">섹터 성격 분류</h2>
        <div className="sector-guide-nature-grid">
          {(["cyclical", "defensive", "interest_sensitive", "growth"] as SectorNature[]).map((nature) => {
            const sectors = SECTOR_META_DATA.filter((m) => m.nature === nature)
            const cats = [...new Set(sectors.map((s) => s.wicsCategory))]
            const descriptions: Record<SectorNature, string> = {
              cyclical:           "경기 확장 시 수익 급증, 수축 시 타격이 큼. 선행지표에 민감.",
              defensive:          "경기 흐름과 무관하게 안정적 수요 유지. 불황기 포트폴리오 방어.",
              interest_sensitive: "금리 방향에 수익성이 크게 좌우됨. 금리 상승 시 주목.",
              growth:             "실적보다 미래 성장 가치를 반영. 경기 호황·저금리 환경에 강함.",
            }
            return (
              <div key={nature} className="sector-guide-nature-card">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                  <NatureBadge nature={nature} />
                  <span className="title-md">{NATURE_LABELS[nature]}</span>
                </div>
                <p className="muted" style={{ marginBottom: "var(--space-3)", lineHeight: 1.55 }}>{descriptions[nature]}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
                  {cats.map((c) => (
                    <span key={c} className="sector-guide-cat-tag">{c}</span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 금리·물가 민감도 */}
      <section className="sector-guide-section">
        <h2 className="sector-guide-section__title">금리 · 물가 환경별 선호 섹터</h2>
        <div className="sector-guide-macro-grid">
          {[
            { key: "rateUp" as const,      icon: "📈", label: "금리 상승기",   color: "var(--color-stock-up)" },
            { key: "rateDown" as const,    icon: "📉", label: "금리 하락기",   color: "var(--color-stock-down)" },
            { key: "inflationUp" as const, icon: "🔥", label: "물가 상승기",   color: "var(--color-orange-500)" },
          ].map(({ key, icon, label, color }) => {
            const data = MACRO_SENSITIVITY[key]
            return (
              <div key={key} className="sector-guide-macro-card">
                <div className="sector-guide-macro-card__header">
                  <span style={{ fontSize: "1.25rem" }}>{icon}</span>
                  <span className="title-md" style={{ color }}>{label}</span>
                </div>
                <div className="sector-guide-macro-row">
                  <span className="sector-guide-macro-row__label positive">유리</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
                    {data.favorable.map((t) => (
                      <span key={t} className="sector-guide-cat-tag sector-guide-cat-tag--positive">{t}</span>
                    ))}
                  </div>
                </div>
                <div className="sector-guide-macro-row">
                  <span className="sector-guide-macro-row__label negative">불리</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
                    {data.unfavorable.map((t) => (
                      <span key={t} className="sector-guide-cat-tag sector-guide-cat-tag--negative">{t}</span>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Top-Down 투자 프로세스 */}
      <section className="sector-guide-section">
        <h2 className="sector-guide-section__title">Top-Down 투자 프로세스</h2>
        <div className="sector-guide-process">
          {[
            { step: 1, title: "거시경제 분석",       desc: "GDP 성장률·금리 방향·인플레이션·환율 등 거시지표로 현재 경기 국면을 파악합니다." },
            { step: 2, title: "경기 국면 판단",       desc: "회복기·호황기·둔화기·침체기 중 어디에 있는지 확인합니다. ISM 제조업 지수, 장단기금리차, 실업률을 참고합니다." },
            { step: 3, title: "유리한 섹터 선별",     desc: "현재 국면에서 아웃퍼폼 가능성이 높은 섹터를 위 가이드를 참고해 선별합니다." },
            { step: 4, title: "섹터 ETF·종목 선정",  desc: "'유망 섹터' 탭에서 점수 상위 섹터를 확인하고, 대장주 TOP 3에서 구체적 종목을 검토합니다." },
            { step: 5, title: "3~6개월 단위 재조정", desc: "경기 국면이 변화하면 섹터 비중을 재조정합니다. 단기 매매보다 국면 전환 타이밍에 집중합니다." },
          ].map(({ step, title, desc }) => (
            <div key={step} className="sector-guide-process-step">
              <div className="sector-guide-process-step__num">{step}</div>
              <div>
                <div className="sector-guide-process-step__title">{title}</div>
                <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────

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
  const [leadersCriteria, setLeadersCriteria] = useState<string>("is_sector_leader desc, market_cap desc, liquidity desc")
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(initAll.length > 0 ? new Date().toISOString() : null)
  const detectedPhase = detectCurrentPhase(all)
  const latestUpdatedAt = useMemo(() => {
    const values = all
      .map((sector) => sector.updated_at)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value))
    if (values.length === 0) return null
    return new Date(Math.max(...values)).toISOString()
  }, [all])
  const displayUpdatedAt = latestUpdatedAt ?? lastLoadedAt

  const loadData = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch("/api/ui/sectors", { cacheMs: force ? 0 : SECTORS_TTL, timeoutMs: 15_000 })
      const data: Sector[] = res?.data ?? []
      setAll(data)
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
  const sorted = [...all].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const promising = sorted.filter((s) => (s.score ?? 0) >= 55)
  const next = [...all]
    .filter((s) => {
      const flow5d = (toNum(s.metrics?.flow_foreign_5d) ?? 0) + (toNum(s.metrics?.flow_inst_5d) ?? 0)
      return flow5d > 0 || ((s.change_rate ?? 0) > 0 && (s.score ?? 0) >= 40)
    })
    .sort((a, b) => {
      const flowA = (toNum(a.metrics?.flow_foreign_5d) ?? 0) + (toNum(a.metrics?.flow_inst_5d) ?? 0)
      const flowB = (toNum(b.metrics?.flow_foreign_5d) ?? 0) + (toNum(b.metrics?.flow_inst_5d) ?? 0)
      const flowDiff = flowB - flowA
      if (flowDiff !== 0) return flowDiff
      return (b.change_rate ?? 0) - (a.change_rate ?? 0)
    })

  const displayed = tab === "promising" ? (promising.length > 0 ? promising : sorted) : next

  useEffect(() => {
    if (tab === "promising" || tab === "next") {
      const ids = displayed.slice(0, 20).map((s) => s.id)
      void loadSectorLeaders(ids)
    }
  }, [displayed, loadSectorLeaders, tab])

  const TAB_ITEMS: { key: Tab; label: string }[] = [
    { key: "promising", label: "유망 섹터" },
    { key: "next",      label: "다음 섹터" },
    { key: "all",       label: "전체 섹터" },
    { key: "guide",     label: "섹터 가이드" },
  ]

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
        detectedPhase={detectedPhase}
        latestUpdatedAt={displayUpdatedAt}
        onRefresh={() => loadData(true)}
        refreshing={loading}
      />

      {loading && all.length > 0 && tab !== "guide" && (
        <div className="muted" style={{ marginBottom: "var(--space-3)", fontSize: "var(--font-size-sm)" }}>
          섹터 데이터를 불러오는 중입니다…
        </div>
      )}

      {/* 탭 */}
      <div className="sector-sheet__tabs" style={{ display: "flex", gap: 0, marginBottom: "var(--space-4)", borderBottom: "1px solid var(--color-border-default)" }}>
        {TAB_ITEMS.map(({ key, label }) => (
          <button
            key={key}
            className={`sector-tab-btn${tab === key ? " sector-tab-btn--active" : ""}`}
            onClick={() => { setTab(key); setExpandedSectorId(null) }}
          >
            {label}
          </button>
        ))}
      </div>

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
              최근 5일 외국인/기관 수급과 단기 등락률을 함께 반영한 <strong>순환매 후보 섹터</strong>입니다.
            </p>
          )}
        </div>
      )}

      {/* 유망·다음 섹터 */}
      {(tab === "promising" || tab === "next") && (
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
      {tab === "guide" && <SectorGuideView detectedPhase={detectedPhase} />}
    </section>
  )
}
