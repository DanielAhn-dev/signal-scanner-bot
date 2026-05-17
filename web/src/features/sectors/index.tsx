import React, { useEffect, useState, useCallback } from "react"
import { apiFetch } from "../../lib/api"
import Button from "../../components/ui/Button"
import Skeleton from "../../components/Skeleton"
import { ErrorState } from "../../components/StateViews"
import EconomicEventBadge from "../../components/EconomicEventBadge"

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

const ANALYZE_PENDING_CODE_KEY = "analyze_pending_code"

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
  if (core != null) parts.push(`핵심 종목 ${Math.round(core)}개`)
  if (stock != null) parts.push(`구성 종목 ${Math.round(stock)}개`)
  if (inst5d != null) {
    const dir = inst5d > 0 ? "기관 5일 순유입" : inst5d < 0 ? "기관 5일 순유출" : "기관 5일 중립"
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

type Tab = "promising" | "next"

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

  const loadData = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch("/api/ui/sectors", { cacheMs: force ? 0 : SECTORS_TTL, timeoutMs: 15_000 })
      const data: Sector[] = res?.data ?? []
      setAll(data)
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
      const joined = target.join(',')
      const res = await apiFetch(`/api/ui/sector-leaders?sectorIds=${encodeURIComponent(joined)}&limitPerSector=3`, {
        cacheMs: force ? 0 : SECTORS_TTL,
        timeoutMs: 15_000,
      })
      const rows = (res?.data ?? {}) as Record<string, SectorLeader[]>
      setSectorLeaders((prev) => ({ ...prev, ...rows }))
      if (typeof res?.criteria === 'string' && res.criteria.trim()) {
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
    } catch {
      // ignore
    }
  }, [onNavigate])

  const onSectorCardClick = useCallback((sectorId: string) => {
    setExpandedSectorId((prev) => prev === sectorId ? null : sectorId)
    if (!sectorLeaders[sectorId]) {
      void loadSectorLeaders([sectorId])
    }
  }, [loadSectorLeaders, sectorLeaders])

  // 탭별 정렬/필터
  const sorted = [...all].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  // 유망 섹터: score >= 55 (또는 상위 50%)
  const promising = sorted.filter(s => (s.score ?? 0) >= 55)
  // 다음 섹터: 5일 수급(외+기) 우선, 동률일 때 등락률 우선
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
    const ids = displayed.slice(0, 20).map((s) => s.id)
    void loadSectorLeaders(ids)
  }, [displayed, loadSectorLeaders])

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>섹터</h1>
        <Button variant="secondary" onClick={() => loadData(true)} disabled={loading}>
          {loading ? "⟳ 새로고침 중…" : "새로고침"}
        </Button>
      </div>
      <EconomicEventBadge onNavigateToCalendar={() => onNavigate?.('economy')} />
      {loading && all.length > 0 && (
        <div className="muted" style={{ marginBottom: "var(--space-3)", fontSize: "var(--font-size-sm)" }}>
          섹터 데이터를 불러오는 중입니다…
        </div>
      )}

      {/* 탭 */}
      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
        <button
          className={`sector-tab-btn${tab === "promising" ? " sector-tab-btn--active" : ""}`}
          onClick={() => setTab("promising")}
        >유망 섹터 (/섹터)</button>
        <button
          className={`sector-tab-btn${tab === "next" ? " sector-tab-btn--active" : ""}`}
          onClick={() => setTab("next")}
        >다음 섹터 (/다음섹터)</button>
      </div>

      {error && <ErrorState message={error} onRetry={() => loadData(true)} />}

      {/* 설명 */}
      <div className="card mb-4" style={{ padding: "var(--space-3) var(--space-4)" }}>
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

      {loading && displayed.length === 0 ? (
        <div className="cards-list">
          {[0,1,2,3,4].map(i => <div key={i} className="card"><Skeleton lines={2} height={14} /></div>)}
        </div>
      ) : displayed.length === 0 ? (
        <div className="card"><div className="muted">데이터 없음</div></div>
      ) : (
        <div className="cards-list" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.25s" }}>
          {displayed.map((s, idx) => {
            const metricsSummary = buildMetricsSummary(s)
            const reason = buildSectorReason(s, tab)
            return (
              <div
                key={s.id}
                className={`card sector-row-card${expandedSectorId === s.id ? " sector-row-card--expanded" : ""}`}
              >
                <button
                  type="button"
                  className="sector-row-trigger"
                  onClick={() => onSectorCardClick(s.id)}
                  aria-expanded={expandedSectorId === s.id}
                >
                  <div className="sector-row-left">
                    <div className="sector-row-rank">#{idx + 1}</div>
                    <div>
                      <div className="sector-row-name">{s.name}</div>
                      {metricsSummary && <div className="sector-row-meta"><span className="caption">{metricsSummary}</span></div>}
                      <p className="muted" style={{ margin: "6px 0 0", lineHeight: 1.45 }}>{reason}</p>
                    </div>
                  </div>
                  <div className="sector-row-right">
                    <ScoreBadge score={s.score} />
                    <ChangeRate val={s.change_rate} />
                  </div>
                </button>
                {expandedSectorId === s.id && (
                  <div className="sector-leader-panel" onClick={(e) => e.stopPropagation()}>
                    <div className="sector-leader-title">대장주 TOP 3 (기준: 리더플래그 → 시총 → 유동성)</div>
                    {leadersLoading ? (
                      <div className="muted">대장주를 계산하는 중입니다…</div>
                    ) : leadersError ? (
                      <div className="muted">대장주 데이터를 불러오지 못했습니다: {leadersError}</div>
                    ) : (sectorLeaders[s.id] ?? []).length === 0 ? (
                      <div className="muted">현재 섹터에 표시할 후보 종목이 없습니다.</div>
                    ) : (
                      <div className="sector-leader-list">
                        {(sectorLeaders[s.id] ?? []).map((leader, leaderIdx) => (
                          <button
                            key={`${s.id}-${leader.code}`}
                            type="button"
                            className="sector-leader-item"
                            onClick={() => navigateToAnalyze(leader.code)}
                            title={`${leader.name} 분석으로 이동`}
                          >
                            <span className="sector-leader-rank">{leaderIdx + 1}위</span>
                            <span className="sector-leader-name">{leader.name}</span>
                            <span className="sector-leader-code">{leader.code}</span>
                            <span className="sector-leader-score">
                              시총 {leader.market_cap != null ? `${formatKoreanMoney(leader.market_cap)}원` : '-'}
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
          })}
        </div>
      )}
    </section>
  )
}
