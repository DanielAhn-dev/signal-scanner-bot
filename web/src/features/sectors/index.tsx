import React, { useEffect, useState, useCallback } from "react"
import { apiFetch } from "../../lib/api"
import Button from "../../components/ui/Button"
import Skeleton from "../../components/Skeleton"
import { ErrorState } from "../../components/StateViews"

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
  metrics?: Record<string, any>
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

export default function SectorsPage() {
  const initAll = readLS<Sector[]>(LS_KEY, SECTORS_TTL) ?? []
  const [all, setAll] = useState<Sector[]>(initAll)
  const [loading, setLoading] = useState(initAll.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("promising")

  const loadData = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch("/api/ui/sectors", { cacheMs: force ? 0 : SECTORS_TTL })
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

  // 탭별 정렬/필터
  const sorted = [...all].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  // 유망 섹터: score >= 55 (또는 상위 50%)
  const promising = sorted.filter(s => (s.score ?? 0) >= 55)
  // 다음 섹터: change_rate 내림차순 (수급 유입 기대), score 중간 이상
  const next = [...all]
    .filter(s => s.change_rate != null && (s.score ?? 0) >= 40)
    .sort((a, b) => (b.change_rate ?? 0) - (a.change_rate ?? 0))

  const displayed = tab === "promising" ? (promising.length > 0 ? promising : sorted) : next

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>섹터</h1>
        <Button variant="secondary" onClick={() => loadData(true)} disabled={loading}>
          {loading ? "로딩..." : "새로고침"}
        </Button>
      </div>

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
            등락률 기준 <strong>수급 유입이 기대되는 섹터</strong>입니다. 텔레그램 <code>/다음섹터</code> 명령과 동일한 데이터입니다.
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
        <div className="cards-list">
          {displayed.map((s, idx) => {
            const metaKeys = s.metrics ? Object.keys(s.metrics).slice(0, 3) : []
            return (
              <div key={s.id} className="card sector-row-card">
                <div className="sector-row-left">
                  <div className="sector-row-rank">#{idx + 1}</div>
                  <div>
                    <div className="sector-row-name">{s.name}</div>
                    {metaKeys.length > 0 && (
                      <div className="sector-row-meta">
                        {metaKeys.map(k => (
                          <span key={k} className="caption">{k}: {String(s.metrics![k])}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="sector-row-right">
                  <ScoreBadge score={s.score} />
                  <ChangeRate val={s.change_rate} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
