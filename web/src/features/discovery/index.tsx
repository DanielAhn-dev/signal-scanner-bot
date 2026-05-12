import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
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

type ApiScoreBreakdown = Partial<ScoreBreakdown> & {
  valueScore?: number
  momentumScore?: number
  smartMoneyScore?: number
  sectorScore?: number
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

function toSafeNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function normalizeScore(raw: ApiScoreBreakdown | null | undefined): ScoreBreakdown {
  const src = raw ?? {}
  return {
    totalScore: toSafeNumber(src.totalScore),
    value: toSafeNumber(src.value ?? src.valueScore),
    momentum: toSafeNumber(src.momentum ?? src.momentumScore),
    smartMoney: toSafeNumber(src.smartMoney ?? src.smartMoneyScore),
    sector: toSafeNumber(src.sector ?? src.sectorScore),
  }
}

function normalizePick(raw: any): DiscoveryPick {
  return {
    code: String(raw?.code ?? ''),
    name: String(raw?.name ?? ''),
    marketCap: toSafeNumber(raw?.marketCap),
    pbr: raw?.pbr == null ? null : Number(raw.pbr),
    per: raw?.per == null ? null : Number(raw.per),
    roe: raw?.roe == null ? null : Number(raw.roe),
    revQoq: raw?.revQoq == null ? null : Number(raw.revQoq),
    opQoq: raw?.opQoq == null ? null : Number(raw.opQoq),
    revAcceleration: raw?.revAcceleration == null ? null : Number(raw.revAcceleration),
    opAcceleration: raw?.opAcceleration == null ? null : Number(raw.opAcceleration),
    smartMoney12w: toSafeNumber(raw?.smartMoney12w),
    smartMoneyRatioPct: raw?.smartMoneyRatioPct == null ? null : Number(raw.smartMoneyRatioPct),
    score: normalizeScore(raw?.score),
  }
}

type DiscoveryCriteria = {
  minMarketCapBillion: number
  minRoe: number
  maxPbr: number
  qoqMode: 'two-quarter-positive' | 'latest-quarter-positive'
}

type DiscoveryFunnel = {
  annualUniverse: number
  afterMarketCap: number
  afterValue: number
  afterTrendData: number
  afterGrowth: number
}

type DiscoveryPreset = {
  key: string
  label: string
  hint: string
  criteria: DiscoveryCriteria
}

const DEFAULT_CRITERIA: DiscoveryCriteria = {
  minMarketCapBillion: 500,
  minRoe: 8,
  maxPbr: 2,
  qoqMode: 'two-quarter-positive',
}

const DISCOVERY_PRESETS: DiscoveryPreset[] = [
  {
    key: 'starter-balance',
    label: '입문 균형형',
    hint: '후보 수와 품질 균형',
    criteria: {
      minMarketCapBillion: 500,
      minRoe: 8,
      maxPbr: 2,
      qoqMode: 'latest-quarter-positive',
    },
  },
  {
    key: 'quality-focus',
    label: '품질 엄격형',
    hint: '후보는 적지만 보수적',
    criteria: {
      minMarketCapBillion: 500,
      minRoe: 10,
      maxPbr: 1.6,
      qoqMode: 'two-quarter-positive',
    },
  },
  {
    key: 'early-discovery',
    label: '초기 발굴형',
    hint: '초기 모멘텀 탐색',
    criteria: {
      minMarketCapBillion: 300,
      minRoe: 6,
      maxPbr: 2.5,
      qoqMode: 'latest-quarter-positive',
    },
  },
]

function criteriaSignature(c: DiscoveryCriteria): string {
  return [c.minMarketCapBillion, c.minRoe, c.maxPbr, c.qoqMode].join('|')
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
  const [criteria, setCriteria] = useState<DiscoveryCriteria>(DEFAULT_CRITERIA)
  const [appliedCriteria, setAppliedCriteria] = useState<DiscoveryCriteria>(DEFAULT_CRITERIA)
  const [funnel, setFunnel] = useState<DiscoveryFunnel | null>(null)

  async function fetchPicks(n: number, c: DiscoveryCriteria) {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(n),
        minMarketCapBillion: String(c.minMarketCapBillion),
        minRoe: String(c.minRoe),
        maxPbr: String(c.maxPbr),
        qoqMode: c.qoqMode,
      })
      const res = await apiFetch(`/api/ui/discovery-picks?${params.toString()}`, {
        cacheMs: 120_000,
        timeoutMs: 30_000,
      })
      const nextPicks = Array.isArray(res?.picks) ? res.picks.map((row: any) => normalizePick(row)) : []
      setPicks(nextPicks)
      setFetchedAt(res.fetchedAt ?? null)
      setFunnel(res.funnel ?? null)
      if (res.criteria) {
        setAppliedCriteria({
          minMarketCapBillion: Number(res.criteria.minMarketCapBillion ?? c.minMarketCapBillion),
          minRoe: Number(res.criteria.minRoe ?? c.minRoe),
          maxPbr: Number(res.criteria.maxPbr ?? c.maxPbr),
          qoqMode: (res.criteria.qoqMode === 'latest-quarter-positive' ? 'latest-quarter-positive' : 'two-quarter-positive'),
        })
      } else {
        setAppliedCriteria(c)
      }
    } catch (err: any) {
      setError(err?.message ?? '데이터 조회 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPicks(limit, criteria)
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
    fetchPicks(n, criteria)
  }

  function applyCriteria() {
    fetchPicks(limit, criteria)
  }

  function applyPreset(preset: DiscoveryPreset) {
    setCriteria(preset.criteria)
    fetchPicks(limit, preset.criteria)
  }

  const appliedPresetKey = DISCOVERY_PRESETS.find((p) => criteriaSignature(p.criteria) === criteriaSignature(appliedCriteria))?.key ?? null

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
            onClick={() => fetchPicks(limit, criteria)}
            disabled={loading}
          >
            {loading ? '조회 중...' : '새로고침'}
          </Button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="muted">
          후보 <strong>{picks.length}</strong>개 · 필터 기준: 시총 {appliedCriteria.minMarketCapBillion}억↑,
          {' '}PBR {'<'} {appliedCriteria.maxPbr.toFixed(1)}, ROE {'>'} {appliedCriteria.minRoe.toFixed(1)}%,
          {' '}{appliedCriteria.qoqMode === 'two-quarter-positive' ? '최근 2분기 매출·영업이익 QoQ 양수' : '최신 분기 매출·영업이익 QoQ 양수'}
          {updatedLabel ? ` · ${updatedLabel}` : ''}
        </div>
      </div>

      <div className="card mb-4">
        <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>기준 설정</div>
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <div className="caption" style={{ marginBottom: 'var(--space-2)' }}>초보자 추천 프리셋</div>
          <div className="flex-gap-sm" style={{ flexWrap: 'wrap' }}>
            {DISCOVERY_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                variant={appliedPresetKey === preset.key ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => applyPreset(preset)}
                disabled={loading}
                title={preset.hint}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="cards-grid cols-3 discovery-criteria-grid" style={{ marginBottom: 'var(--space-2)' }}>
          <Input
            label="최소 시총(억)"
            type="number"
            min={100}
            step={50}
            value={criteria.minMarketCapBillion}
            onChange={(e) => setCriteria((prev) => ({ ...prev, minMarketCapBillion: Number(e.target.value || 0) }))}
          />
          <Input
            label="최소 ROE(%)"
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={criteria.minRoe}
            onChange={(e) => setCriteria((prev) => ({ ...prev, minRoe: Number(e.target.value || 0) }))}
          />
          <Input
            label="최대 PBR"
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            value={criteria.maxPbr}
            onChange={(e) => setCriteria((prev) => ({ ...prev, maxPbr: Number(e.target.value || 0) }))}
          />
        </div>
        <div className="flex-between" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div className="ui-field" style={{ minWidth: 260 }}>
            <label className="ui-label">성장 조건</label>
            <select
              className="input"
              value={criteria.qoqMode}
              onChange={(e) => setCriteria((prev) => ({
                ...prev,
                qoqMode: e.target.value === 'latest-quarter-positive' ? 'latest-quarter-positive' : 'two-quarter-positive',
              }))}
            >
              <option value="two-quarter-positive">최근 2분기 모두 QoQ 양수</option>
              <option value="latest-quarter-positive">최신 분기 QoQ 양수</option>
            </select>
          </div>
          <div className="flex-gap-sm">
            <Button variant="secondary" size="sm" onClick={() => setCriteria(appliedCriteria)} disabled={loading}>
              적용값으로 되돌리기
            </Button>
            <Button variant="primary" size="sm" onClick={applyCriteria} disabled={loading}>
              기준 적용
            </Button>
          </div>
        </div>
      </div>

      {funnel && (
        <div className="card mb-4">
          <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>필터 퍼널</div>
          <div className="caption" style={{ lineHeight: 1.8 }}>
            연간 재무 유니버스 {funnel.annualUniverse}개 → 시총 통과 {funnel.afterMarketCap}개 → 가치 통과 {funnel.afterValue}개 →
            최근 2분기 데이터 보유 {funnel.afterTrendData}개 → 최종 성장 조건 통과 {funnel.afterGrowth}개
          </div>
        </div>
      )}

      {loading && (
        <div className="card mb-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} height={42} style={{ marginBottom: i === 7 ? 0 : 8 }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <ErrorState message={error} onRetry={() => fetchPicks(limit, criteria)} />
      )}

      {!loading && !error && picks.length === 0 && (
        <div className="card mb-4">
          <EmptyState
            message={
              funnel
                ? `조건에 맞는 후보가 없습니다. 현재 퍼널 마지막 단계 통과: ${funnel.afterGrowth}개`
                : '조건에 맞는 후보가 없습니다. ETL 실행 후 다시 확인해 주세요.'
            }
          />
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
