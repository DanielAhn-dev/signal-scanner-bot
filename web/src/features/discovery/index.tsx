import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'

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
  sectorId: string | null
  sectorName: string | null
  sectorRawScore: number | null
  marketCap: number
  pbr: number | null
  per: number | null
  roe: number | null
  peg: number | null
  pegSource: 'net_income_forward' | 'net_income' | 'op_income' | 'sales' | null
  revQoq: number | null
  opQoq: number | null
  revAcceleration: number | null
  opAcceleration: number | null
  smartMoney12w: number
  smartMoneyRatioPct: number | null
  score: ScoreBreakdown
}

type SectorSnapshot = {
  id: string
  name: string
  score: number | null
  change_rate: number | null
}

type SectorFilterMode = 'all' | 'promising' | 'next' | 'promising-or-next'

type DiscoveryCriteria = {
  minMarketCapBillion: number
  minRoe: number
  maxPbr: number
  minPeg: number | null
  maxPeg: number | null
  qoqMode: 'two-quarter-positive' | 'latest-quarter-positive'
}

type DiscoveryFunnel = {
  annualUniverse: number
  afterMarketCap: number
  afterValue: number
  afterPeg: number
  afterTrendData: number
  afterGrowth: number
}

type DiscoveryPreset = {
  key: string
  label: string
  hint: string
  criteria: DiscoveryCriteria
  sectorMode: SectorFilterMode
}

const DEFAULT_CRITERIA: DiscoveryCriteria = {
  minMarketCapBillion: 500,
  minRoe: 8,
  maxPbr: 2,
  minPeg: null,
  maxPeg: null,
  qoqMode: 'two-quarter-positive',
}

const DISCOVERY_PRESET_COLLAPSED_COUNT = 4

const DISCOVERY_PRESETS: DiscoveryPreset[] = [
  {
    key: 'starter-balance',
    label: '입문 균형형',
    hint: '후보 수와 품질 균형',
    criteria: {
      minMarketCapBillion: 500,
      minRoe: 8,
      maxPbr: 2,
      minPeg: null,
      maxPeg: null,
      qoqMode: 'latest-quarter-positive',
    },
    sectorMode: 'all',
  },
  {
    key: 'quality-focus',
    label: '품질 엄격형',
    hint: '후보는 적지만 보수적',
    criteria: {
      minMarketCapBillion: 500,
      minRoe: 10,
      maxPbr: 1.6,
      minPeg: null,
      maxPeg: null,
      qoqMode: 'two-quarter-positive',
    },
    sectorMode: 'all',
  },
  {
    key: 'early-discovery',
    label: '초기 발굴형',
    hint: '초기 모멘텀 탐색',
    criteria: {
      minMarketCapBillion: 300,
      minRoe: 6,
      maxPbr: 2.5,
      minPeg: null,
      maxPeg: null,
      qoqMode: 'latest-quarter-positive',
    },
    sectorMode: 'all',
  },
  {
    key: 'leader-sector-follow',
    label: '주도 섹터 추종형',
    hint: '점수 상위 섹터 내 종목 우선',
    criteria: {
      minMarketCapBillion: 500,
      minRoe: 8,
      maxPbr: 2.1,
      minPeg: null,
      maxPeg: null,
      qoqMode: 'two-quarter-positive',
    },
    sectorMode: 'promising',
  },
  {
    key: 'rotation-early',
    label: '다음 섹터 선점형',
    hint: '수급 유입 기대 섹터를 선제 탐색',
    criteria: {
      minMarketCapBillion: 300,
      minRoe: 6,
      maxPbr: 2.4,
      minPeg: null,
      maxPeg: null,
      qoqMode: 'latest-quarter-positive',
    },
    sectorMode: 'next',
  },
  {
    key: 'dual-sector-barbell',
    label: '듀얼 섹터 바벨형',
    hint: '주도+다음 섹터를 동시에 추적',
    criteria: {
      minMarketCapBillion: 400,
      minRoe: 7,
      maxPbr: 2.2,
      minPeg: null,
      maxPeg: null,
      qoqMode: 'latest-quarter-positive',
    },
    sectorMode: 'promising-or-next',
  },
  {
    key: 'large-cap-leaders',
    label: '대장주 추종형',
    hint: '섹터별 시총 상위 대형주 발굴',
    criteria: {
      minMarketCapBillion: 1000,
      minRoe: 3,
      maxPbr: 2.5,
      minPeg: null,
      maxPeg: null,
      qoqMode: 'latest-quarter-positive',
    },
    sectorMode: 'promising',
  },
  {
    key: 'peg-extreme-undervalue',
    label: 'PEG 극저평가형',
    hint: '피터 린치 우량 저평가 기준 (PEG < 0.5)',
    criteria: {
      minMarketCapBillion: 500,
      minRoe: 8,
      maxPbr: 2.0,
      minPeg: null,
      maxPeg: 0.5,
      qoqMode: 'two-quarter-positive',
    },
    sectorMode: 'all',
  },
  {
    key: 'peg-undervalue',
    label: 'PEG 저평가형',
    hint: '성장 대비 저평가 (PEG < 1.0)',
    criteria: {
      minMarketCapBillion: 500,
      minRoe: 8,
      maxPbr: 2.0,
      minPeg: null,
      maxPeg: 1.0,
      qoqMode: 'two-quarter-positive',
    },
    sectorMode: 'all',
  },
  {
    key: 'peg-fair-value',
    label: 'PEG 적정가형',
    hint: '성장 대비 적정 평가 (1.0 ≤ PEG ≤ 1.5)',
    criteria: {
      minMarketCapBillion: 500,
      minRoe: 8,
      maxPbr: 2.0,
      minPeg: 1.0,
      maxPeg: 1.5,
      qoqMode: 'two-quarter-positive',
    },
    sectorMode: 'all',
  },
]

function criteriaSignature(c: DiscoveryCriteria, sectorMode: SectorFilterMode): string {
  return [c.minMarketCapBillion, c.minRoe, c.maxPbr, c.minPeg ?? '', c.maxPeg ?? '', c.qoqMode, sectorMode].join('|')
}

function asFiniteNumber(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normalizeScore(raw: any): ScoreBreakdown {
  const totalScore = asFiniteNumber(raw?.totalScore) ?? 0
  const valueScore = asFiniteNumber(raw?.value) ?? asFiniteNumber(raw?.valueScore) ?? 0
  const momentumScore = asFiniteNumber(raw?.momentum) ?? asFiniteNumber(raw?.momentumScore) ?? 0
  const smartMoneyScore = asFiniteNumber(raw?.smartMoney) ?? asFiniteNumber(raw?.smartMoneyScore) ?? 0
  const sectorScore = asFiniteNumber(raw?.sector) ?? asFiniteNumber(raw?.sectorScore) ?? 0
  return {
    totalScore,
    value: valueScore,
    momentum: momentumScore,
    smartMoney: smartMoneyScore,
    sector: sectorScore,
  }
}

function normalizePick(raw: any): DiscoveryPick {
  return {
    code: String(raw?.code ?? ''),
    name: String(raw?.name ?? ''),
    sectorId: raw?.sectorId != null ? String(raw.sectorId) : null,
    sectorName: raw?.sectorName != null ? String(raw.sectorName) : null,
    sectorRawScore: asFiniteNumber(raw?.sectorRawScore),
    marketCap: asFiniteNumber(raw?.marketCap) ?? 0,
    pbr: asFiniteNumber(raw?.pbr),
    per: asFiniteNumber(raw?.per),
    roe: asFiniteNumber(raw?.roe),
    peg: asFiniteNumber(raw?.peg),
    pegSource:
      raw?.pegSource === 'net_income_forward' ||
      raw?.pegSource === 'net_income' ||
      raw?.pegSource === 'op_income' ||
      raw?.pegSource === 'sales'
      ? raw.pegSource
      : null,
    revQoq: asFiniteNumber(raw?.revQoq),
    opQoq: asFiniteNumber(raw?.opQoq),
    revAcceleration: asFiniteNumber(raw?.revAcceleration),
    opAcceleration: asFiniteNumber(raw?.opAcceleration),
    smartMoney12w: asFiniteNumber(raw?.smartMoney12w) ?? 0,
    smartMoneyRatioPct: asFiniteNumber(raw?.smartMoneyRatioPct),
    score: normalizeScore(raw?.score),
  }
}

function ScoreBadge({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100)
  const cls =
    pct >= 75 ? 'scan-grade-a' : pct >= 50 ? 'scan-grade-b' : pct >= 30 ? 'scan-grade-c' : 'scan-grade-other'
  const roundedValue = Math.round(value)
  const isSingleDigit = roundedValue < 10
  return <span className={`scan-grade-badge ${cls} ${isSingleDigit ? 'scan-grade-badge--circle' : 'scan-grade-badge--pill'}`}>{roundedValue}</span>
}

function QoQCell({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <span className="bt-table-num">—</span>
  const pos = value >= 0
  return (
    <span style={{ color: pos ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
      {pos ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}

function MarketCapCell({ value }: { value: number }) {
  if (!value) return <span className="bt-table-num">—</span>
  if (value >= 1_000_000_000_000) return <span className="bt-table-num">{(value / 1_000_000_000_000).toFixed(1)}조</span>
  return <span className="bt-table-num">{Math.round(value / 100_000_000).toLocaleString()}억</span>
}

function navigateTo(route: string) {
  try {
    window.history.pushState({}, '', `/${route}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    // ignore
  }
}

const SECTOR_MODE_LABELS: Record<SectorFilterMode, string> = {
  all: '전체 섹터',
  promising: '유망 섹터',
  next: '다음 섹터',
  'promising-or-next': '유망+다음',
}

export default function DiscoveryPage() {
  const [picks, setPicks] = useState<DiscoveryPick[]>([])
  const [sectors, setSectors] = useState<SectorSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(20)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [criteria, setCriteria] = useState<DiscoveryCriteria>(DEFAULT_CRITERIA)
  const [appliedCriteria, setAppliedCriteria] = useState<DiscoveryCriteria>(DEFAULT_CRITERIA)
  const [sectorMode, setSectorMode] = useState<SectorFilterMode>('all')
  const [appliedSectorMode, setAppliedSectorMode] = useState<SectorFilterMode>('all')
  const [funnel, setFunnel] = useState<DiscoveryFunnel | null>(null)
  const [showAllPresets, setShowAllPresets] = useState(false)

  async function fetchSectors() {
    try {
      const res = await apiFetch('/api/ui/sectors', {
        cacheMs: 60_000,
        timeoutMs: 15_000,
      })
      const data = Array.isArray(res?.data) ? res.data : []
      setSectors(
        data.map((row: any) => ({
          id: String(row?.id ?? ''),
          name: String(row?.name ?? row?.id ?? ''),
          score: asFiniteNumber(row?.score),
          change_rate: asFiniteNumber(row?.change_rate),
        })).filter((row: SectorSnapshot) => row.id.length > 0)
      )
    } catch {
      setSectors([])
    }
  }

  async function fetchPicks(n: number, c: DiscoveryCriteria, mode: SectorFilterMode = sectorMode) {
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
      if (c.minPeg != null) params.set('minPeg', String(c.minPeg))
      if (c.maxPeg != null) params.set('maxPeg', String(c.maxPeg))
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
          minPeg: res.criteria.minPeg == null ? null : Number(res.criteria.minPeg),
          maxPeg: res.criteria.maxPeg == null ? null : Number(res.criteria.maxPeg),
          qoqMode: (res.criteria.qoqMode === 'latest-quarter-positive' ? 'latest-quarter-positive' : 'two-quarter-positive'),
        })
      } else {
        setAppliedCriteria(c)
      }
      setAppliedSectorMode(mode)
    } catch (err: any) {
      setError(err?.message ?? '데이터 조회 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSectors()
    fetchPicks(limit, criteria, sectorMode)
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
    fetchPicks(n, criteria, sectorMode)
  }

  function applyCriteria() {
    fetchPicks(limit, criteria, sectorMode)
  }

  function applyPreset(preset: DiscoveryPreset) {
    setCriteria(preset.criteria)
    setSectorMode(preset.sectorMode)
    fetchPicks(limit, preset.criteria, preset.sectorMode)
  }

  const appliedPresetKey = DISCOVERY_PRESETS.find((p) => criteriaSignature(p.criteria, p.sectorMode) === criteriaSignature(appliedCriteria, appliedSectorMode))?.key ?? null
  const appliedPresetLabel = DISCOVERY_PRESETS.find((p) => p.key === appliedPresetKey)?.label ?? '커스텀 기준'

  const visiblePresets = useMemo(() => {
    if (showAllPresets) return DISCOVERY_PRESETS
    return DISCOVERY_PRESETS.slice(0, DISCOVERY_PRESET_COLLAPSED_COUNT)
  }, [showAllPresets])

  useEffect(() => {
    if (!appliedPresetKey) return
    const isInCollapsed = DISCOVERY_PRESETS
      .slice(0, DISCOVERY_PRESET_COLLAPSED_COUNT)
      .some((preset) => preset.key === appliedPresetKey)
    if (!isInCollapsed) setShowAllPresets(true)
  }, [appliedPresetKey])

  const sectorScoreMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const sector of sectors) {
      if (sector.score != null) m.set(sector.id, sector.score)
    }
    return m
  }, [sectors])

  const promisingSectorIds = useMemo(() => {
    return new Set(sectors.filter((s) => (s.score ?? -1) >= 55).map((s) => s.id))
  }, [sectors])

  const nextSectorIds = useMemo(() => {
    return new Set(sectors.filter((s) => (s.score ?? -1) >= 40 && (s.change_rate ?? 0) > 0).map((s) => s.id))
  }, [sectors])

  const filteredPicks = useMemo(() => {
    if (sectorMode === 'all') return picks

    const hasSectorUniverse = promisingSectorIds.size > 0 || nextSectorIds.size > 0
    if (!hasSectorUniverse) {
      if (sectorMode === 'promising') {
        return picks.filter((pick) => (pick.sectorRawScore ?? sectorScoreMap.get(pick.sectorId ?? '') ?? -1) >= 55)
      }
      return picks
    }

    return picks.filter((pick) => {
      const sid = pick.sectorId
      if (!sid) return false
      if (sectorMode === 'promising') return promisingSectorIds.has(sid)
      if (sectorMode === 'next') return nextSectorIds.has(sid)
      return promisingSectorIds.has(sid) || nextSectorIds.has(sid)
    })
  }, [nextSectorIds, picks, promisingSectorIds, sectorMode, sectorScoreMap])

  const sectorModeSummary = useMemo(() => {
    if (sectorMode === 'all') return '전체 섹터'
    if (sectorMode === 'promising') return `유망 섹터(${promisingSectorIds.size}개)`
    if (sectorMode === 'next') return `다음 섹터(${nextSectorIds.size}개)`
    return `유망+다음 섹터(${new Set([...promisingSectorIds, ...nextSectorIds]).size}개)`
  }, [nextSectorIds, promisingSectorIds, sectorMode])

  const updatedLabel = fetchedAt
    ? `${new Date(fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`
    : null

  return (
    <div className="bt-page">
      {/* 헤더 */}
      <div className="bt-header">
        <div>
          <h1 className="bt-title">멀티배거 발굴</h1>
          <p className="bt-desc">
            펀더멘털(PBR·ROE·PEG·QoQ) × 스마트머니(12주 수급) × 섹터 복합 점수 기반 중장기 후보
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {([10, 20, 30] as const).map((n) => (
            <button
              key={n}
              className={`sim-btn ${limit === n ? 'sim-btn--primary' : 'sim-btn--ghost'}`}
              style={{ minHeight: 32, padding: '6px 10px' }}
              onClick={() => handleLimitChange(n)}
              disabled={loading}
            >
              TOP {n}
            </button>
          ))}
          <button
            className="sim-btn sim-btn--ghost"
            style={{ minHeight: 32, padding: '6px 12px' }}
            onClick={() => fetchPicks(limit, criteria, sectorMode)}
            disabled={loading}
          >
            {loading ? '조회 중...' : '새로고침'}
          </button>
        </div>
      </div>

      {/* 요약 */}
      <div className="bt-summary-card">
        <div className="bt-summary-grid">
          <div className="bt-summary-item">
            <span className="bt-summary-label">후보</span>
            <span className="bt-summary-value">{filteredPicks.length}개</span>
          </div>
          <div className="bt-summary-item">
            <span className="bt-summary-label">섹터 모드</span>
            <span className="bt-summary-value">{sectorModeSummary}</span>
          </div>
          <div className="bt-summary-item">
            <span className="bt-summary-label">최소 시총</span>
            <span className="bt-summary-value">{appliedCriteria.minMarketCapBillion}억↑</span>
          </div>
          <div className="bt-summary-item">
            <span className="bt-summary-label">PBR / ROE</span>
            <span className="bt-summary-value">&lt;{appliedCriteria.maxPbr.toFixed(1)} / &gt;{appliedCriteria.minRoe.toFixed(1)}%</span>
          </div>
          <div className="bt-summary-item">
            <span className="bt-summary-label">PEG 범위</span>
            <span className="bt-summary-value">
              {appliedCriteria.minPeg != null ? `${appliedCriteria.minPeg}↑` : '하한없음'} · {appliedCriteria.maxPeg != null ? `${appliedCriteria.maxPeg}↓` : '상한없음'}
            </span>
          </div>
          <div className="bt-summary-item">
            <span className="bt-summary-label">적용 기준</span>
            <span className="bt-summary-value" style={{ fontSize: 11 }}>
              {appliedPresetLabel}{updatedLabel ? ` · ${updatedLabel}` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* 기준 설정 */}
      <div className="bt-params-card">
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <span className="bt-param-label" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>프리셋</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {visiblePresets.map((preset) => (
              <button
                key={preset.key}
                className={`sim-btn ${appliedPresetKey === preset.key ? 'sim-btn--primary' : 'sim-btn--ghost'}`}
                style={{ minHeight: 30, padding: '6px 10px' }}
                onClick={() => applyPreset(preset)}
                disabled={loading}
                title={preset.hint}
              >
                {preset.label}
              </button>
            ))}
            {DISCOVERY_PRESETS.length > DISCOVERY_PRESET_COLLAPSED_COUNT && (
              <button
                className="sim-btn sim-btn--ghost"
                style={{ minHeight: 30, padding: '6px 10px' }}
                onClick={() => setShowAllPresets((prev) => !prev)}
                disabled={loading}
              >
                {showAllPresets
                  ? '접기'
                  : `+${DISCOVERY_PRESETS.length - DISCOVERY_PRESET_COLLAPSED_COUNT}개 더`}
              </button>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 'var(--space-3)' }}>
          <span className="bt-param-label" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>섹터 범위</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['all', 'promising', 'next', 'promising-or-next'] as const).map((mode) => (
              <button
                key={mode}
                className={`sim-btn ${sectorMode === mode ? 'sim-btn--primary' : 'sim-btn--ghost'}`}
                style={{ minHeight: 30, padding: '6px 10px' }}
                onClick={() => setSectorMode(mode)}
                disabled={loading}
              >
                {SECTOR_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="bt-params-grid">
          <div className="bt-param-group">
            <span className="bt-param-label">최소 시총(억)</span>
            <div className="sim-input-row">
              <input
                className="sim-input"
                type="number"
                min={100}
                step={50}
                value={criteria.minMarketCapBillion}
                onChange={(e) => setCriteria((prev) => ({ ...prev, minMarketCapBillion: Number(e.target.value || 0) }))}
              />
            </div>
          </div>
          <div className="bt-param-group">
            <span className="bt-param-label">최소 ROE(%)</span>
            <div className="sim-input-row">
              <input
                className="sim-input"
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={criteria.minRoe}
                onChange={(e) => setCriteria((prev) => ({ ...prev, minRoe: Number(e.target.value || 0) }))}
              />
            </div>
          </div>
          <div className="bt-param-group">
            <span className="bt-param-label">최대 PBR</span>
            <div className="sim-input-row">
              <input
                className="sim-input"
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={criteria.maxPbr}
                onChange={(e) => setCriteria((prev) => ({ ...prev, maxPbr: Number(e.target.value || 0) }))}
              />
            </div>
          </div>
          <div className="bt-param-group">
            <span className="bt-param-label">최소 PEG</span>
            <div className="sim-input-row">
              <input
                className="sim-input"
                type="number"
                min={0.1}
                max={100}
                step={0.1}
                value={criteria.minPeg ?? ''}
                onChange={(e) => setCriteria((prev) => ({ ...prev, minPeg: e.target.value === '' ? null : Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="bt-param-group">
            <span className="bt-param-label">최대 PEG</span>
            <div className="sim-input-row">
              <input
                className="sim-input"
                type="number"
                min={0.1}
                max={100}
                step={0.1}
                value={criteria.maxPeg ?? ''}
                onChange={(e) => setCriteria((prev) => ({ ...prev, maxPeg: e.target.value === '' ? null : Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="bt-param-group">
            <span className="bt-param-label">성장 조건</span>
            <select
              className="sim-input"
              value={criteria.qoqMode}
              onChange={(e) => setCriteria((prev) => ({
                ...prev,
                qoqMode: e.target.value === 'latest-quarter-positive' ? 'latest-quarter-positive' : 'two-quarter-positive',
              }))}
            >
              <option value="two-quarter-positive">최근 2분기 QoQ 양수</option>
              <option value="latest-quarter-positive">최신 분기 QoQ 양수</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button
            className="sim-btn sim-btn--ghost"
            onClick={() => {
              setCriteria(appliedCriteria)
              setSectorMode(appliedSectorMode)
            }}
            disabled={loading}
          >
            적용값으로 되돌리기
          </button>
          <button
            className="sim-btn sim-btn--primary"
            onClick={applyCriteria}
            disabled={loading}
          >
            기준 적용
          </button>
        </div>
      </div>

      {/* 필터 퍼널 */}
      {funnel && (
        <div className="bt-section">
          <div className="bt-section-title">필터 퍼널</div>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0, lineHeight: 1.8 }}>
            연간 재무 유니버스 {funnel.annualUniverse}개 → 시총 통과 {funnel.afterMarketCap}개 → 가치 통과 {funnel.afterValue}개 →
            PEG 조건 통과 {funnel.afterPeg}개 → 최근 2분기 데이터 보유 {funnel.afterTrendData}개 → 최종 성장 조건 통과 {funnel.afterGrowth}개
          </p>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="bt-section">
          <div className="bt-skeleton-rows">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 42, marginBottom: i < 7 ? 8 : 0 }} />
            ))}
          </div>
        </div>
      )}

      {/* 에러 */}
      {!loading && error && (
        <div className="bt-section" style={{ color: 'var(--color-error)' }}>{error}</div>
      )}

      {/* 빈 상태 */}
      {!loading && !error && picks.length === 0 && (
        <div className="bt-section" style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
          {funnel
            ? `조건에 맞는 후보가 없습니다. 현재 퍼널 마지막 단계 통과: ${funnel.afterGrowth}개`
            : '조건에 맞는 후보가 없습니다. ETL 실행 후 다시 확인해 주세요.'}
        </div>
      )}

      {!loading && !error && picks.length > 0 && filteredPicks.length === 0 && (
        <div className="bt-section" style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
          현재 섹터 모드 조건에 맞는 후보가 없습니다. 섹터 모드 또는 기준을 조정해 보세요.
        </div>
      )}

      {/* 결과 테이블 */}
      {!loading && !error && filteredPicks.length > 0 && (
        <div className="bt-section">
          <div style={{ overflowX: 'auto', margin: '0 calc(-1 * var(--space-4))' }}>
            <table className="bt-table" style={{ minWidth: 960 }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>종목</th>
                  <th title="종합 점수 (100점 만점)" style={{ textAlign: 'center' }}>점수</th>
                  <th style={{ textAlign: 'center' }}>가치<br /><small style={{ fontWeight: 400, opacity: 0.7 }}>30pt</small></th>
                  <th style={{ textAlign: 'center' }}>모멘텀<br /><small style={{ fontWeight: 400, opacity: 0.7 }}>40pt</small></th>
                  <th style={{ textAlign: 'center' }}>수급<br /><small style={{ fontWeight: 400, opacity: 0.7 }}>20pt</small></th>
                  <th style={{ textAlign: 'center' }}>섹터<br /><small style={{ fontWeight: 400, opacity: 0.7 }}>10pt</small></th>
                  <th style={{ textAlign: 'right' }}>PEG</th>
                  <th style={{ textAlign: 'right' }}>PBR</th>
                  <th style={{ textAlign: 'right' }}>ROE</th>
                  <th style={{ textAlign: 'right' }}>매출QoQ</th>
                  <th style={{ textAlign: 'right' }}>영업이익QoQ</th>
                  <th style={{ textAlign: 'right' }}>시총</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredPicks.map((pick, idx) => (
                  <tr key={pick.code}>
                    <td>
                      <span className="bt-table-num" style={{ fontWeight: idx < 3 ? 700 : 400, color: idx === 0 ? 'var(--color-success)' : idx < 3 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>
                        {idx + 1}
                      </span>
                    </td>
                    <td>
                      <span className="bt-table-stock-name">{pick.name}</span>
                      <span className="bt-table-stock-code">{pick.code}</span>
                      {pick.sectorName && (
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                          {pick.sectorName}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <ScoreBadge value={pick.score.totalScore} max={100} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <ScoreBadge value={pick.score.value} max={30} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <ScoreBadge value={pick.score.momentum} max={40} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <ScoreBadge value={pick.score.smartMoney} max={20} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <ScoreBadge value={pick.score.sector} max={10} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="bt-table-num">{pick.peg != null ? pick.peg.toFixed(2) : '—'}</div>
                      {pick.pegSource && (
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                          {pick.pegSource === 'net_income_forward'
                            ? '순이익 선행'
                            : pick.pegSource === 'net_income'
                              ? '순이익'
                              : pick.pegSource === 'op_income'
                                ? '영업이익'
                                : '매출'}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }} className="bt-table-num">
                      {pick.pbr != null ? pick.pbr.toFixed(2) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }} className="bt-table-num">
                      {pick.roe != null ? `${pick.roe.toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <QoQCell value={pick.revQoq} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <QoQCell value={pick.opQoq} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <MarketCapCell value={pick.marketCap} />
                    </td>
                    <td>
                      <button
                        className="sim-btn sim-btn--ghost"
                        style={{ minHeight: 28, padding: '4px 10px', fontSize: 11 }}
                        aria-label={`${pick.name} 분석 열기`}
                        onClick={() => handleAnalyze(pick.code)}
                      >
                        분석 →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 각주 */}
      <div className="bt-section">
        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0, lineHeight: 1.7 }}>
          · <strong>가치(30pt)</strong>: PBR 구간 + ROE + PER + PEG 보정 기반<br />
          · <strong>모멘텀(40pt)</strong>: 최신 매출/영업이익 QoQ + 가속도<br />
          · <strong>수급(20pt)</strong>: 최근 12주 외국인+기관 순매수 누적<br />
          · <strong>섹터(10pt)</strong>: 해당 섹터 점수 비례
        </p>
      </div>
    </div>
  )
}
