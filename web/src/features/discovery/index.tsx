import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { EmptyState, ErrorState } from '../../components/StateViews'

const ANALYZE_PENDING_CODE_KEY = 'analyze_pending_code'

type ScoreBreakdown = {
  totalScore: number
  value: number
  momentum: number
  smartMoney: number
  sector: number
}

type DiscoveryPick = {
  code: string
  name: string
  marketCap: number
  pbr: number | null
  per: number | null
  roe: number | null
  revQoq: number | null
  opQoq: number | null
  revAcceleration: number | null
  opAcceleration: number | null
  smartMoney12w: number
  smartMoneyRatioPct: number | null
  score: ScoreBreakdown
}

function ScoreBadge({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100)
  const cls =
    pct >= 75 ? 'scan-grade-a' : pct >= 50 ? 'scan-grade-b' : pct >= 30 ? 'scan-grade-c' : 'scan-grade-other'
  return <span className={`scan-grade-badge ${cls}`}>{value}</span>
}

function QoQCell({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <span className="scan-grade-label">—</span>
  const pos = value >= 0
  return (
    <span style={{ color: pos ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)', fontWeight: 600 }}>
      {pos ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}

function MarketCapCell({ value }: { value: number }) {
  if (!value) return <span className="scan-grade-label">—</span>
  if (value >= 1_000_000_000_000) return <span>{(value / 1_000_000_000_000).toFixed(1)}조</span>
  return <span>{Math.round(value / 100_000_000).toLocaleString()}억</span>
}

function navigateTo(route: string) {
  try {
    window.history.pushState({}, '', `/${route}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    // ignore
  }
}

export default function DiscoveryPage() {
  const [picks, setPicks] = useState<DiscoveryPick[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(20)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  async function fetchPicks(n: number) {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/ui/discovery-picks?limit=${n}`, {
        cacheMs: 120_000,
        timeoutMs: 30_000,
      })
      setPicks(res.picks ?? [])
      setFetchedAt(res.fetchedAt ?? null)
    } catch (err: any) {
      setError(err?.message ?? '데이터 조회 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPicks(limit)
  }, [])

  function handleAnalyze(code: string) {
    try {
      sessionStorage.setItem(ANALYZE_PENDING_CODE_KEY, code)
    } catch {
      // ignore
    }
    navigateTo('analyze')
  }

  function handleLimitChange(n: number) {
    setLimit(n)
    fetchPicks(n)
  }

  const updatedLabel = fetchedAt
    ? `${new Date(fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`
    : null

  return (
    <section className="container-app container-wide">
      <div className="flex-between mb-4" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <div>
          <h1 className="title-xl" style={{ marginBottom: 0 }}>멀티배거 발굴</h1>
          <div className="muted" style={{ marginTop: 'var(--space-1)' }}>
            펀더멘털(PBR·ROE·QoQ) × 스마트머니(12주 수급) × 섹터 복합 점수 기반 중장기 후보
          </div>
        </div>
        <div className="flex-gap-sm" style={{ flexWrap: 'wrap' }}>
          <div className="flex-gap-sm" style={{ flexWrap: 'wrap' }}>
            {([10, 20, 30] as const).map((n) => (
              <Button
                key={n}
                variant={limit === n ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => handleLimitChange(n)}
                disabled={loading}
              >
                TOP {n}
              </Button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchPicks(limit)}
            disabled={loading}
          >
            {loading ? '조회 중...' : '새로고침'}
          </Button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="muted">
          후보 <strong>{picks.length}</strong>개 · 필터 기준: 시총 500억↑, PBR {'<'} 2.0, ROE {'>'} 8%, 최근 2분기 매출·영업이익 QoQ 양수
          {updatedLabel ? ` · ${updatedLabel}` : ''}
        </div>
      </div>

      {loading && (
        <div className="card mb-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} height={42} style={{ marginBottom: i === 7 ? 0 : 8 }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <ErrorState message={error} onRetry={() => fetchPicks(limit)} />
      )}

      {!loading && !error && picks.length === 0 && (
        <div className="card mb-4">
          <EmptyState message="조건에 맞는 후보가 없습니다. ETL 실행 후 다시 확인해 주세요." />
        </div>
      )}

      {!loading && !error && picks.length > 0 && (
        <div className="card mb-4">
          <div className="scan-table-wrap">
          <table className="scan-table">
            <thead className="scan-thead">
              <tr>
                <th className="scan-th">#</th>
                <th className="scan-th">종목</th>
                <th className="scan-th" title="종합 점수 (100점 만점)">점수</th>
                <th className="scan-th">가치<br /><small>30pt</small></th>
                <th className="scan-th">모멘텀<br /><small>40pt</small></th>
                <th className="scan-th">수급<br /><small>20pt</small></th>
                <th className="scan-th">섹터<br /><small>10pt</small></th>
                <th className="scan-th">PBR</th>
                <th className="scan-th">ROE</th>
                <th className="scan-th">매출QoQ</th>
                <th className="scan-th">영업이익QoQ</th>
                <th className="scan-th">시총</th>
                <th className="scan-th">분석</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((pick, idx) => (
                <tr key={pick.code} className="scan-tr">
                  <td className="scan-td">{idx + 1}</td>
                  <td className="scan-td">
                    <div className="scan-td-name">{pick.name}</div>
                    <div className="scan-td-code">{pick.code}</div>
                  </td>
                  <td className="scan-td">
                    <ScoreBadge value={pick.score.totalScore} max={100} />
                  </td>
                  <td className="scan-td">
                    <ScoreBadge value={pick.score.value} max={30} />
                  </td>
                  <td className="scan-td">
                    <ScoreBadge value={pick.score.momentum} max={40} />
                  </td>
                  <td className="scan-td">
                    <ScoreBadge value={pick.score.smartMoney} max={20} />
                  </td>
                  <td className="scan-td">
                    <ScoreBadge value={pick.score.sector} max={10} />
                  </td>
                  <td className="scan-td">
                    {pick.pbr != null ? pick.pbr.toFixed(2) : '—'}
                  </td>
                  <td className="scan-td">
                    {pick.roe != null ? `${pick.roe.toFixed(1)}%` : '—'}
                  </td>
                  <td className="scan-td">
                    <QoQCell value={pick.revQoq} />
                  </td>
                  <td className="scan-td">
                    <QoQCell value={pick.opQoq} />
                  </td>
                  <td className="scan-td">
                    <MarketCapCell value={pick.marketCap} />
                  </td>
                  <td className="scan-td">
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => handleAnalyze(pick.code)}
                    >
                      분석
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="caption" style={{ lineHeight: 1.7 }}>
          · <strong>가치(30pt)</strong>: PBR 구간 + ROE + PER 역수 기반<br />
          · <strong>모멘텀(40pt)</strong>: 최신 매출/영업이익 QoQ + 가속도<br />
          · <strong>수급(20pt)</strong>: 최근 12주 외국인+기관 순매수 누적<br />
          · <strong>섹터(10pt)</strong>: 해당 섹터 점수 비례
        </div>
      </div>
    </section>
  )
}
