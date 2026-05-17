import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState, EmptyState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
import Pagination from '../../components/Pagination'
import useWatchlistActions from '../../hooks/useWatchlistActions'
import ShareModal from '../../components/ShareModal'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import { useShareManager } from '../../hooks/useShareManager'
import { scoreLeadAccumulationCandidate } from '../../lib/accumulationSignal'

const SCAN_SNAPSHOT_KEY = 'scan_snapshot_v1'
const ANALYZE_PENDING_CODE_KEY = 'analyze_pending_code'

type MarketPhase = 'intraday' | 'after-close'

function readScanSnapshot() {
  try {
    const raw = sessionStorage.getItem(SCAN_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.candidates)) return null
    return {
      candidates: parsed.candidates as ScanCandidate[],
      total: Number(parsed.total || 0),
      latestDate: parsed.latestDate ? String(parsed.latestDate) : null,
      marketPhase: parsed.marketPhase === 'intraday' ? 'intraday' : 'after-close',
      realtimeAppliedCount: Number(parsed.realtimeAppliedCount || 0),
    }
  } catch {
    return null
  }
}

function writeScanSnapshot(payload: {
  candidates: ScanCandidate[]
  total: number
  latestDate: string | null
  marketPhase: MarketPhase
  realtimeAppliedCount: number
}) {
  try {
    sessionStorage.setItem(SCAN_SNAPSHOT_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

function buildCandidateSignature(items: ScanCandidate[]): string {
  if (!Array.isArray(items) || items.length === 0) return 'empty'
  return items
    .slice(0, 30)
    .map((item) => {
      const score = Number(item.adaptive_score ?? (item.entry_score ?? 0) * 20 - (item.warn_score ?? 0) * 3)
      return `${item.code}:${Number.isFinite(score) ? score.toFixed(1) : '0.0'}`
    })
    .join('|')
}

type SortDirection = 'asc' | 'desc'
type SortKey =
  | 'code'
  | 'name'
  | 'sector_id'
  | 'priority_score'
  | 'lead_accumulation_score'
  | 'intraday_change_pct'
  | 'entry_grade'
  | 'entry_score'
  | 'trend_grade'
  | 'dist_grade'
  | 'pivot_grade'
  | 'warn_score'
  | 'liquidity'
  | 'trade_date'
  | 'stock_updated_at'

type ScanCandidate = {
  code: string
  name: string
  sector_id: string | null
  liquidity: number | null
  trade_date: string | null
  stock_updated_at: string | null
  entry_grade: string | null
  entry_score: number | null
  trend_grade: string | null
  dist_grade: string | null
  dist_pct: number | null
  pivot_grade: string | null
  vol_atr_grade: string | null
  warn_grade: string | null
  warn_score: number | null
  intraday_change_pct?: number | null
  current_price?: number | null
  price_source?: 'realtime' | 'close'
  adaptive_adjustment?: number | null
  adaptive_reasons?: string[] | null
  adaptive_score?: number | null
  lead_accumulation_score?: number
  lead_accumulation_stage?: 'none' | 'lead' | 'breakout'
}

function getEntryLevel(grade: string | null | undefined): 'a' | 'b' | 'c' {
  const g = String(grade || '').toUpperCase()
  if (g === 'A') return 'a'
  if (g === 'B') return 'b'
  return 'c'
}

function gradeScore(grade: string | null | undefined): number {
  if (!grade) return -1
  const g = String(grade).trim().toUpperCase()
  if (g === 'A') return 5
  if (g === 'B') return 4
  if (g === 'C') return 3
  if (g === 'D') return 2
  if (g === 'E') return 1
  return 0
}

/** 복합 우선순위 점수: entry_score × 20 − warn_score × 3 (범위 약 −18 ~ 80) */
function computePriorityScore(item: ScanCandidate): number {
  if (typeof item.adaptive_score === 'number' && Number.isFinite(item.adaptive_score)) return item.adaptive_score
  return (item.entry_score ?? 0) * 20 - (item.warn_score ?? 0) * 3
}

function toComparableValue(item: ScanCandidate, key: SortKey): string | number {
  if (key === 'priority_score') return computePriorityScore(item)
  if (key === 'lead_accumulation_score') return scoreLeadAccumulationCandidate(item).score
  if (key === 'entry_grade' || key === 'trend_grade' || key === 'dist_grade' || key === 'pivot_grade') {
    return gradeScore(item[key])
  }
  const v = item[key as keyof ScanCandidate]
  if (v == null) return ''
  if (typeof v === 'number') return v
  return String(v)
}

function GradeBadge({ grade, label }: { grade: string | null | undefined; label?: string }) {
  if (!grade) return <span className="scan-grade-label">—</span>
  const g = String(grade).toUpperCase()
  const cls = g === 'A' ? 'scan-grade-a' : g === 'B' ? 'scan-grade-b' : g === 'C' ? 'scan-grade-c' : 'scan-grade-other'
  return (
    <span className="scan-grade-pair">
      {label && <span className="scan-grade-label">{label}</span>}
      <span className={`scan-grade-badge ${cls}`}>{g}</span>
    </span>
  )
}

type ScanHighlightItem = {
  code: string
  name: string
  sector_id: string | null
  entry_grade: string | null
  entry_score: number | null
  trend_grade: string | null
  dist_grade: string | null
  pivot_grade: string | null
  warn_grade: string | null
  warn_score: number | null
  signal?: string | null
  stable_turn?: string | null
  total_score?: number | null
  highlight_score?: number
  adaptive_adjustment?: number | null
  adaptive_reasons?: string[] | null
  adaptive_score?: number | null
}

function WarnBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return <span className="scan-grade-label">—</span>
  const g = String(grade).toUpperCase()
  const cls = g === 'SAFE' ? 'scan-warn-safe' : g === 'WATCH' ? 'scan-warn-watch' : g === 'WARN' ? 'scan-warn-warn' : 'scan-warn-default'
  const label = g === 'SAFE' ? '안전' : g === 'WATCH' ? '관찰' : g === 'WARN' ? '주의' : g
  return <span className={`scan-warn-badge ${cls}`}>{label}</span>
}

function SignalBadge({ signal }: { signal: string | null | undefined }) {
  if (!signal) return null
  const s = String(signal).toUpperCase().trim()
  if (!s || s === 'NEUTRAL' || s === 'NONE') return null
  const cls = s === 'STRONG_BUY' ? 'scan-grade-a' : s === 'BUY' ? 'scan-grade-b' : s === 'WATCH' ? 'scan-grade-c' : 'scan-grade-other'
  const label = s === 'STRONG_BUY' ? '강력매수' : s === 'BUY' ? '매수' : s === 'SELL' ? '매도' : s === 'WATCH' ? '관찰' : s
  return <span className={`scan-grade-badge ${cls}`} title="종합시그널">{label}</span>
}

export default function ScanPage({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const snapshot = readScanSnapshot()
  const [candidates, setCandidates] = useState<ScanCandidate[]>(() => snapshot?.candidates ?? [])
  const [total, setTotal] = useState(() => snapshot?.total ?? 0)
  const [latestDate, setLatestDate] = useState<string | null>(() => snapshot?.latestDate ?? null)
  const [marketPhase, setMarketPhase] = useState<MarketPhase>(() => (
    snapshot?.marketPhase === 'intraday' ? 'intraday' : 'after-close'
  ))
  const [realtimeAppliedCount, setRealtimeAppliedCount] = useState<number>(() => snapshot?.realtimeAppliedCount ?? 0)
  const [loading, setLoading] = useState(() => !snapshot)
  const [error, setError] = useState<string | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [apiHighlights, setApiHighlights] = useState<ScanHighlightItem[]>([])
  const [highlightLoading, setHighlightLoading] = useState(true)
  const [selectedSector, setSelectedSector] = useState<string>('all')
  const [conditionFilter, setConditionFilter] = useState<'all' | 'entry' | 'trend' | 'accumulation' | 'lead' | 'stable'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('priority_score')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const toast = useToast()
  const shareManager = useShareManager({
    endpoint: '/api/ui/route-share',
    scopeKey: 'kind',
    requiresCode: false,
  })
  const toastRef = useRef(toast)
  const lastSignatureRef = useRef<string | null>(null)
  const hasFetchedRef = useRef(false)

  useEffect(() => {
    toastRef.current = toast
  }, [toast])
  const {
    loadWatchlistCodes,
    isWatched,
    isAdding,
    isRemoving,
    addToWatchlist,
    removeFromWatchlist,
  } = useWatchlistActions()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const nextSector = String(params.get('sector') || '').trim()
    const nextFilter = String(params.get('filter') || '').trim()

    if (nextSector) setSelectedSector(nextSector)
    if (['all', 'entry', 'trend', 'accumulation', 'stable'].includes(nextFilter)) {
      setConditionFilter(nextFilter as typeof conditionFilter)
    }
  }, [])

  const loadCandidates = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    setError(null)
    try {
      const ts = Date.now()
      const res = await apiFetch(`/api/ui/scan-candidates?limit=80&cacheMs=0&_ts=${ts}`, {
        cacheMs: 0,
        timeoutMs: 25_000,
      })
      const nextCandidates = Array.isArray(res?.data) ? (res.data as ScanCandidate[]) : []
      const nextSignature = buildCandidateSignature(nextCandidates)
      const prevSignature = lastSignatureRef.current

      if (!options?.silent && hasFetchedRef.current) {
        if (prevSignature === nextSignature) {
          toastRef.current.show(`데이터 동일 · 기준일 ${res?.latestDate ?? '—'} · ${res?.marketPhase === 'intraday' ? '장중(현재가 반영 없음/미미)' : '종가 기준'}`)
        } else {
          toastRef.current.show(`데이터 업데이트 감지 · 기준일 ${res?.latestDate ?? '—'}`)
        }
      }

      lastSignatureRef.current = nextSignature
      hasFetchedRef.current = true

      setCandidates(nextCandidates)
      setTotal(res?.count ?? 0)
      setLatestDate(res?.latestDate ?? null)
      setMarketPhase(res?.marketPhase === 'intraday' ? 'intraday' : 'after-close')
      setRealtimeAppliedCount(Number(res?.realtimeAppliedCount ?? 0))
      writeScanSnapshot({
        candidates: nextCandidates,
        total: res?.count ?? 0,
        latestDate: res?.latestDate ?? null,
        marketPhase: res?.marketPhase === 'intraday' ? 'intraday' : 'after-close',
        realtimeAppliedCount: Number(res?.realtimeAppliedCount ?? 0),
      })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCandidates()
  }, [loadCandidates])

  useEffect(() => {
    setHighlightLoading(true)
    apiFetch('/api/ui/scan-highlights', { cacheMs: 60_000, timeoutMs: 30_000 })
      .then((res) => { if (Array.isArray(res?.data)) setApiHighlights(res.data) })
      .catch(() => { /* API 호출 실패 시 로컈 폴백 사용 */ })
      .finally(() => setHighlightLoading(false))
  }, [])
  useEffect(() => {
    loadWatchlistCodes().catch(() => {
      // 관심종목 조회 실패 시에도 스캔 화면은 계속 사용 가능해야 함
    })
  }, [loadWatchlistCodes])

  const triggerScan = async () => {
    setScanLoading(true)
    toast.show('동기화 시작 중… 완료까지 수 분 소요될 수 있습니다.')
    try {
      const res = await apiFetch('/api/ui/trigger-update', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 180_000,
        body: JSON.stringify({
          runScripts: true,
          pipeline: 'intraday-refresh',
        }),
      })
      if (res?.ok) {
        const runnerEnabled = !!res?.scriptRunner?.enabled
        const runnerRequested = !!res?.scriptRunner?.requested
        const runnerOk = !!res?.scriptRunner?.result?.ok

        if (runnerRequested && !runnerEnabled) {
          toast.show('DB 갱신만 완료됨(장중 신호 재계산 스크립트 비활성). 서버 ENABLE_WEB_SCRIPT_RUNNER 확인 필요')
        } else if (runnerRequested && !runnerOk) {
          toast.show('DB 갱신 완료, 장중 신호 재계산 일부 실패(서버 로그 확인 필요)')
        } else {
          toast.show('장중 눌림목 재계산 완료 ✓')
        }
        await loadCandidates()
      } else {
        const detail = res?.body?.error || res?.error || '스캔 요청 실패'
        toast.show(`동기화 실패: ${String(detail)}`)
      }
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (msg.toLowerCase().includes('timed out') || msg.toLowerCase().includes('network error') || msg.toLowerCase().includes('failed to fetch')) {
        toast.show('서버 응답 시간 초과. 동기화는 백그라운드에서 계속 실행될 수 있습니다. 잠시 후 새로고침해 주세요.')
      } else {
        toast.show(`오류: ${msg}`)
      }
    } finally {
      setScanLoading(false)
    }
  }

  const navigateToAnalyze = (code: string) => {
    try { sessionStorage.setItem(ANALYZE_PENDING_CODE_KEY, code) } catch { /* ignore */ }
    onNavigate?.('analyze')
  }

  const sectors = useMemo(
    () => ['all', ...new Set(candidates.map((row) => row.sector_id).filter((v): v is string => !!v))],
    [candidates],
  )

  const localHighlights = useMemo<ScanHighlightItem[]>(() => {
    return [...candidates]
      .filter(c => ['A', 'B'].includes(String(c.entry_grade || '').toUpperCase()))
      .sort((a, b) => {
        const ga = gradeScore(a.entry_grade)
        const gb = gradeScore(b.entry_grade)
        if (ga !== gb) return gb - ga
        const wa = a.warn_score ?? 999
        const wb = b.warn_score ?? 999
        if (wa !== wb) return wa - wb
        return (b.entry_score ?? 0) - (a.entry_score ?? 0)
      })
      .slice(0, 5)
  }, [candidates])

  // API 하이라이트가 있으면 우선 사용, 없으면 로컈 폴백
  const activeHighlights = apiHighlights.length > 0 ? apiHighlights : localHighlights

  const filterCounts = useMemo(() => {
    const base = selectedSector === 'all' ? candidates : candidates.filter(c => c.sector_id === selectedSector)
    return {
      all: base.length,
      entry: base.filter(c => ['A', 'B'].includes(String(c.entry_grade || '').toUpperCase())).length,
      trend: base.filter(c => ['A', 'B'].includes(String(c.trend_grade || '').toUpperCase())).length,
      accumulation: base.filter(c => ['A', 'B'].includes(String(c.dist_grade || '').toUpperCase())).length,
      lead: base.filter((c) => scoreLeadAccumulationCandidate(c).stage !== 'none').length,
      stable: base.filter(c => ['A', 'B'].includes(String(c.pivot_grade || '').toUpperCase())).length,
    }
  }, [candidates, selectedSector])

  const filteredCandidates = useMemo(() => candidates.filter((item) => {
    if (selectedSector !== 'all' && item.sector_id !== selectedSector) return false
    if (conditionFilter === 'entry') return ['A', 'B'].includes(String(item.entry_grade || '').toUpperCase())
    if (conditionFilter === 'trend') return ['A', 'B'].includes(String(item.trend_grade || '').toUpperCase())
    if (conditionFilter === 'accumulation') return ['A', 'B'].includes(String(item.dist_grade || '').toUpperCase())
    if (conditionFilter === 'lead') return scoreLeadAccumulationCandidate(item).stage !== 'none'
    if (conditionFilter === 'stable') return ['A', 'B'].includes(String(item.pivot_grade || '').toUpperCase())
    return true
  }), [candidates, selectedSector, conditionFilter])

  const sortedCandidates = useMemo(() => [...filteredCandidates].sort((a, b) => {
    const av = toComparableValue(a, sortKey)
    const bv = toComparableValue(b, sortKey)
    const result = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), 'ko-KR')
    return sortDirection === 'asc' ? result : -result
  }), [filteredCandidates, sortKey, sortDirection])

  const pagedCandidates = useMemo(() => {
    const from = (page - 1) * pageSize
    return sortedCandidates.slice(from, from + pageSize)
  }, [sortedCandidates, page])

  const totalPages = Math.ceil(sortedCandidates.length / pageSize)

  const displayRows = useMemo(() => pagedCandidates.map((s) => ({
    ...s,
    priorityScore: Number(computePriorityScore(s).toFixed(1)),
    leadAccumulationScore: Number(scoreLeadAccumulationCandidate(s).score.toFixed(1)),
    leadAccumulationStage: scoreLeadAccumulationCandidate(s).stage,
    intradayChangePct: typeof s.intraday_change_pct === 'number' ? s.intraday_change_pct : null,
    tradeDateText: s.trade_date ?? '—',
    updatedAtText: s.stock_updated_at
      ? new Date(s.stock_updated_at).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      : null,
    updatedDateText: s.stock_updated_at
      ? new Date(s.stock_updated_at).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      : '—',
  })), [pagedCandidates])

  useEffect(() => {
    setPage(1)
  }, [selectedSector])

  // 필터 탭별 기본 정렬 기준
  const FILTER_DEFAULT_SORT: Record<typeof conditionFilter, SortKey> = {
    all: 'priority_score',
    entry: 'entry_score',
    trend: 'trend_grade',
    accumulation: 'dist_grade',
    lead: 'lead_accumulation_score',
    stable: 'pivot_grade',
  }

  const handleConditionFilter = (filter: typeof conditionFilter) => {
    setConditionFilter(filter)
    setSortKey(FILTER_DEFAULT_SORT[filter])
    setSortDirection('desc')
    setPage(1)
  }

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection(key === 'code' || key === 'name' || key === 'sector_id' ? 'asc' : 'desc')
  }

  const onAddToWatchlist = async (code: string) => {
    try {
      const result = await addToWatchlist(code)
      if (result === 'added') {
        toast.show('관심 종목에 추가되었습니다 ✓')
      } else if (result === 'exists') {
        toast.show('이미 관심 종목에 있습니다')
      }
    } catch (e: any) {
      toast.show(String(e?.message || e))
    }
  }

  const onToggleWatchlist = async (e: React.MouseEvent, code: string) => {
    e.stopPropagation()
    if (!code) return
    if (isWatched(code)) {
      try {
        const result = await removeFromWatchlist(code)
        if (result === 'removed' || result === 'not-found') {
          toast.show('관심 종목에서 제거되었습니다')
        }
      } catch (e: any) {
        toast.show(String(e?.message || e))
      }
      return
    }
    await onAddToWatchlist(code)
  }

  const onShareScan = async () => {
    const rows = sortedCandidates.slice(0, 30).map((row) => ({
      code: row.code,
      name: row.name,
      sector: row.sector_id,
      entryGrade: row.entry_grade,
      trendGrade: row.trend_grade,
      distGrade: row.dist_grade,
      pivotGrade: row.pivot_grade,
      warnGrade: row.warn_grade,
      warnScore: row.warn_score,
      entryScore: row.entry_score,
      priorityScore: Number(computePriorityScore(row).toFixed(1)),
      intradayChangePct: typeof row.intraday_change_pct === 'number' ? row.intraday_change_pct : null,
      tradeDate: row.trade_date,
    }))

    await shareManager.createShare('scan', {
      kind: 'scan',
      payload: {
        viewMode: 'table',
        latestDate,
        marketPhase,
        realtimeAppliedCount,
        sectionLabels: {
          highlights: '참고용 추천 눌림목',
          candidates: '실전 기준 후보 목록',
        },
        conditionFilter,
        conditionFilterLabel:
          conditionFilter === 'entry' ? '진입(A/B)' :
          conditionFilter === 'trend' ? '추세(A/B)' :
          conditionFilter === 'accumulation' ? '매집(A/B)' :
          conditionFilter === 'lead' ? '매집 선행형' :
          conditionFilter === 'stable' ? '세력선(A/B)' : '전체',
        selectedSector,
        sectorLabel: selectedSector === 'all' ? '전체 섹터' : selectedSector,
        rows,
      },
    })
  }

  const renderSortableHeader = (label: string, key: SortKey) => {
    const active = sortKey === key
    const marker = active ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''
    return (
      <button
        type="button"
        onClick={() => onSort(key)}
        className={`scan-sort-btn${active ? ' scan-sort-btn--active' : ''}`}
      >
        {label}{marker}
      </button>
    )
  }

  return (
    <section className="container-app container-wide">
      {/* 페이지 헤더 */}
      <h1 className="title-xl mb-4" style={{ marginBottom: 'var(--space-3)' }}>눌림목</h1>


      <EconomicEventBadge onNavigateToCalendar={() => onNavigate?.('economy')} />

      {/* 상태 표시 */}
      <div className="card mb-4">
        <div className="muted">
          <span className="scan-stat-count">{sortedCandidates.length}</span>개 후보 ·
          최신 기준일 {latestDate ?? '—'} · {marketPhase === 'intraday' ? `장중 현재가 반영(${realtimeAppliedCount}건)` : '종가 기준'} · 텔레그램 pullback 신호 기반 · 종목 클릭 시 상세 분석으로 이동
        </div>
      </div>

      {/* 필터 */}
      <div className="card mb-4">
        <div className="muted mb-4" style={{ marginBottom: 'var(--space-2)' }}>필터</div>
        <div className="scan-filter-section mb-4" style={{ marginBottom: 'var(--space-2)' }}>
          {([
            { key: 'all', label: '전체' },
            { key: 'entry', label: '진입(A/B)' },
            { key: 'trend', label: '추세(A/B)' },
            { key: 'accumulation', label: '매집(A/B)' },
            { key: 'lead', label: '매집 선행형' },
            { key: 'stable', label: '세력선(A/B)' },
          ] as const).map((option) => (
            <button
              key={option.key}
              className={`tag${conditionFilter === option.key ? ' active' : ''}`}
              onClick={() => handleConditionFilter(option.key)}
            >
              {option.label} ({filterCounts[option.key]})
            </button>
          ))}
        </div>
        <div className="scan-filter-section">
          <span className="scan-filter-label">섹터</span>
          <select
            className="input scan-sector-select"
            value={selectedSector}
            onChange={(e) => setSelectedSector(e.target.value)}
          >
            {sectors.map((sector) => (
              <option key={sector} value={sector}>{sector === 'all' ? '전체 섹터' : sector}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={loadCandidates} />}

      {/* 참고용 추천 섹션 */}
      {!loading && !error && !highlightLoading && activeHighlights.length > 0 && conditionFilter === 'all' && selectedSector === 'all' && (
        <div className="card mb-4" id="scan-highlight-section-capture">
          <div className="scan-highlight-section-title">
            <div className="scan-highlight-section-copy">
              <span className="scan-highlight-section-label">참고용 추천 눌림목</span>
              <span className="scan-highlight-section-subtitle">상단 참고 · 하단 실전 기준과 분리</span>
            </div>
            {onNavigate && (
              <Button variant="secondary" onClick={() => onNavigate('highlights')}>
                하이라이트 허브
              </Button>
            )}
          </div>

          <div className="scan-highlight-grid">
            {activeHighlights.map((c, idx) => (
              <button
                key={c.code}
                type="button"
                className={`scan-highlight-card${idx === 0 ? ' scan-highlight-card--top' : ''}`}
                onClick={() => navigateToAnalyze(c.code)}
                title={`${c.name} 참고용 상세 보기`}
              >
                <div className="scan-highlight-card-head">
                  <span className={`scan-highlight-rank${idx > 0 ? ' scan-highlight-rank--rest' : ''}`}>
                    TOP {idx + 1}
                  </span>
                  <WarnBadge grade={c.warn_grade} />
                </div>
                <div>
                  <div className="scan-highlight-name">{c.name}</div>
                  <div className="scan-highlight-code">{c.code}</div>
                </div>
                <div className="scan-highlight-grades">
                  <GradeBadge grade={c.entry_grade} label="진입" />
                  <GradeBadge grade={c.trend_grade} label="추세" />
                  <GradeBadge grade={c.dist_grade} label="매집" />
                  {c.pivot_grade && <GradeBadge grade={c.pivot_grade} label="세력" />}
                  {c.signal && <SignalBadge signal={c.signal} />}
                </div>
                <div className="scan-highlight-meta">
                  {c.sector_id && <span>{c.sector_id}</span>}
                  {c.entry_score != null && <span>진입 {formatNumber(c.entry_score, 1)}</span>}
                  {c.total_score != null && <span>종합 {formatNumber(c.total_score, 0)}</span>}
                  {typeof c.adaptive_adjustment === 'number' && Math.abs(c.adaptive_adjustment) >= 0.1 && (
                    <span style={{ color: c.adaptive_adjustment >= 0 ? 'var(--color-positive)' : 'var(--color-negative)' }}>
                      적응 {c.adaptive_adjustment > 0 ? '+' : ''}{formatNumber(c.adaptive_adjustment, 1)}
                    </span>
                  )}
                </div>
                <div className="scan-highlight-hint">참고용 상세 분석 →</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 전체 목록 */}
      {loading && candidates.length === 0 ? (
        <div className="card"><Skeleton lines={6} height={16} /></div>
      ) : !error && sortedCandidates.length === 0 ? (
        <EmptyState title="스캔 결과 없음" description="스캔을 실행하거나 필터를 조정해 보세요." />
      ) : (
        <div id="scan-candidates-section-capture">
          {(conditionFilter !== 'all' || selectedSector !== 'all') && (
            <div className="scan-section-label scan-section-label--plain">
              {conditionFilter !== 'all'
                ? `필터 결과 · ${sortedCandidates.length}개`
                : `${selectedSector} 섹터 · ${sortedCandidates.length}개`}
            </div>
          )}
          {conditionFilter === 'all' && selectedSector === 'all' && (
            <div className="scan-section-label scan-section-label--plain">
              전체 후보 목록 · {sortedCandidates.length}개 (실전 기준, 오늘 장중/종가 신호 반영)
            </div>
          )}
          <div className="scan-candidates-stage">
            <div className="scan-table-wrap">
              <table className="scan-table">
              <thead className="scan-thead">
                <tr>
                  <th className="scan-th">{renderSortableHeader('코드', 'code')}</th>
                  <th className="scan-th">{renderSortableHeader('종목명', 'name')}</th>
                  <th className="scan-th">{renderSortableHeader('섹터', 'sector_id')}</th>
                  <th className="scan-th">{renderSortableHeader('우선순위', 'priority_score')}</th>
                  <th className="scan-th">{renderSortableHeader('선행매집', 'lead_accumulation_score')}</th>
                  <th className="scan-th">{renderSortableHeader('진입', 'entry_grade')}</th>
                  <th className="scan-th">{renderSortableHeader('진입점수', 'entry_score')}</th>
                  <th className="scan-th">{renderSortableHeader('추세', 'trend_grade')}</th>
                  <th className="scan-th">{renderSortableHeader('매집', 'dist_grade')}</th>
                  <th className="scan-th">{renderSortableHeader('세력선', 'pivot_grade')}</th>
                  <th className="scan-th">{renderSortableHeader('경고', 'warn_score')}</th>
                  <th className="scan-th">{renderSortableHeader('유동성', 'liquidity')}</th>
                  <th className="scan-th">{renderSortableHeader('변동(%)', 'intraday_change_pct')}</th>
                  <th className="scan-th">{renderSortableHeader('기준일', 'trade_date')}</th>
                  <th className="scan-th">관리</th>
                </tr>
              </thead>
                <tbody>
                {displayRows.map((s: any) => {
                  const code = String(s.code)
                  const isAdded = isWatched(code)
                  const isAddingNow = isAdding(code)
                  const isRemovingNow = isRemoving(code)
                  const isMutating = isAddingNow || isRemovingNow
                  return (
                    <tr
                      key={s.code}
                      className={`scan-tr scan-tr--level-${getEntryLevel(s.entry_grade)}`}
                      onClick={() => navigateToAnalyze(code)}
                      title={`${s.name} 상세 분석`}
                    >
                      <td className="scan-td scan-td-code" data-label="코드">{s.code}</td>
                      <td className="scan-td scan-td-name" data-label="종목명">{s.name}</td>
                      <td className="scan-td scan-td-sector" data-label="섹터">{s.sector_id ?? '—'}</td>
                      <td className="scan-td number" data-label="우선순위" title="진입점수×20 − 경고점수×3 + 장중 현재가 보정">
                        <span className={s.priorityScore >= 60 ? 'scan-grade-badge scan-grade-a' : s.priorityScore >= 40 ? 'scan-grade-badge scan-grade-b' : 'scan-grade-label'}>
                          {formatNumber(s.priorityScore, 1)}
                        </span>
                      </td>
                      <td className="scan-td number" data-label="선행매집" title="매집·세력선·추세·경고·이격 기반 선행형 점수">
                        <span className={s.leadAccumulationScore >= 75 ? 'scan-grade-badge scan-grade-a' : s.leadAccumulationScore >= 55 ? 'scan-grade-badge scan-grade-b' : 'scan-grade-label'}>
                          {formatNumber(s.leadAccumulationScore, 0)}
                        </span>
                        {s.leadAccumulationStage && s.leadAccumulationStage !== 'none' && (
                          <span className="scan-grade-label"> ({s.leadAccumulationStage === 'breakout' ? '돌파' : '선행'})</span>
                        )}
                      </td>
                      <td className="scan-td" data-label="진입">
                        <GradeBadge grade={s.entry_grade} />
                      </td>
                      <td className="scan-td number" data-label="진입점수">
                        {s.entry_score != null ? formatNumber(s.entry_score, 2) : '—'}
                      </td>
                      <td className="scan-td" data-label="추세">
                        <GradeBadge grade={s.trend_grade} />
                      </td>
                      <td className="scan-td" data-label="매집">
                        <GradeBadge grade={s.dist_grade} />
                        {s.dist_pct != null && (
                          <span className="scan-grade-label"> ({formatNumber(s.dist_pct, 2)}%)</span>
                        )}
                      </td>
                      <td className="scan-td" data-label="세력선">
                        <GradeBadge grade={s.pivot_grade} />
                        {s.vol_atr_grade && (
                          <span className="scan-grade-label"> / {s.vol_atr_grade}</span>
                        )}
                      </td>
                      <td className="scan-td" data-label="경고">
                        <WarnBadge grade={s.warn_grade} />
                        {s.warn_score != null && s.warn_score > 0 && (
                          <span className="scan-grade-label"> ({Math.round(s.warn_score)})</span>
                        )}
                      </td>
                      <td className="scan-td number number-right" data-label="유동성">
                        {s.liquidity != null ? formatNumber(s.liquidity, 0) : '—'}
                      </td>
                      <td className="scan-td number number-right" data-label="변동(%)">
                        {typeof s.intradayChangePct === 'number'
                          ? (
                            <span style={{
                              color: s.intradayChangePct > 0
                                ? 'var(--color-success)'
                                : s.intradayChangePct < 0
                                  ? 'var(--color-error)'
                                  : undefined,
                              fontWeight: 600,
                            }}>
                              {s.intradayChangePct > 0 ? '+' : ''}{formatNumber(s.intradayChangePct, 2)}%
                            </span>
                            )
                          : '—'}
                      </td>
                      <td className="scan-td scan-td-date" data-label="기준일">
                        <div>{s.tradeDateText}</div>
                        {s.updatedAtText && (
                          <div className="scan-td-updated-sub">{s.updatedAtText}</div>
                        )}
                      </td>
                      <td className="scan-td" data-label="관리" onClick={(e) => e.stopPropagation()}>
                        <Button
                          className="watchlist-icon-btn scan-watch-add-btn"
                          variant="ghost"
                          onClick={(e: React.MouseEvent) => onToggleWatchlist(e, code)}
                          disabled={isMutating}
                          title={isAdded ? '관심 종목에서 제거' : '관심 종목에 추가'}
                        >
                          <span className="watchlist-btn-symbol" aria-hidden>{isAdded ? 'x' : '+'}</span>
                          <span className="watchlist-btn-label">
                            {isAddingNow ? '추가중' : isRemovingNow ? '제거중' : isAdded ? '제거' : '추가'}
                          </span>
                        </Button>
                      </td>
                    </tr>
                  )
                })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="pagination-wrap">
                <Pagination page={page} pageSize={pageSize} total={sortedCandidates.length} onChange={setPage} />
              </div>
            )}
          </div>
        </div>
      )}
      <ShareModal
        open={shareManager.open}
        onClose={shareManager.close}
        url={shareManager.info?.url}
        code={shareManager.info?.code}
        requiresCode={shareManager.requiresCode}
        expiresAt={shareManager.info?.expiresAt}
        shares={shareManager.list}
        loading={shareManager.loading}
        onRefresh={() => { void shareManager.loadList('scan') }}
        includeAll={shareManager.includeAll}
        onChangeIncludeAll={shareManager.setIncludeAll}
        onRevoke={shareManager.revokeShare}
        revokingId={shareManager.revokingId}
      />
    </section>
  )
}
