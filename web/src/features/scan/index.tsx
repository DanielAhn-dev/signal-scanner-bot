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
import SheetHeaderBar from '../../components/SheetHeaderBar'
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
  const [isMobileViewport, setIsMobileViewport] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false
  ))
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(max-width: 640px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
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

  const navigateToBacktest = (code: string) => {
    try { sessionStorage.setItem('backtest_pending_code', code) } catch { /* ignore */ }
    if (onNavigate) {
      onNavigate('backtest')
    } else {
      window.location.href = '/backtest'
    }
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
    <div className="xls-page-inset scan-page">
      {/* ── 헤더 테이블 (제목·필터·섹터) — 4열, B2 안전 여백 내 ── */}
      <div className="xls-scroll-frame" style={{ ['--xls-table-min-width' as any]: '360px' }}>
      <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '30%' }} />
          <col style={{ width: '30%' }} />
          <col style={{ width: '20%' }} />
        </colgroup>
        <tbody>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
              <SheetHeaderBar
                title="눌림목"
                action={<EconomicEventBadge onNavigateToCalendar={() => onNavigate?.('economy')} />}
              />
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" colSpan={4}
              style={{ color: 'var(--color-text-secondary)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span className="scan-stat-count">{sortedCandidates.length}</span>개 후보 ·
              최신 기준일 {latestDate ?? '—'} · {marketPhase === 'intraday' ? `장중 현재가 반영(${realtimeAppliedCount}건)` : '종가 기준'} · 텔레그램 pullback 신호 기반 · 종목 클릭 시 상세 분석으로 이동
            </td>
          </tr>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={4} style={{ padding: '3px 6px', overflow: 'visible' }}>
              <div className="scan-cond-chips">
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
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" style={{ fontWeight: 600, fontSize: 11, color: 'var(--color-text-secondary)' }}>
              섹터 필터
            </td>
            <td className="xls-cell" colSpan={3} style={{ padding: '2px 6px' }}>
              <select
                className="input scan-sector-select"
                value={selectedSector}
                onChange={(e) => setSelectedSector(e.target.value)}
                style={{ width: '100%', height: 18, fontSize: 11, padding: '0 4px', border: '1px solid var(--color-excel-grid-border)', background: 'var(--color-gray-0)' }}
              >
                {sectors.map((sector) => (
                  <option key={sector} value={sector}>{sector === 'all' ? '전체 섹터' : sector}</option>
                ))}
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      {error && <ErrorState message={error} onRetry={loadCandidates} />}

      {/* 참고용 추천 섹션 */}
      {!loading && !error && !highlightLoading && activeHighlights.length > 0 && conditionFilter === 'all' && selectedSector === 'all' && (
        <div className="scan-highlights-section">
        <table className="xls-table scan-highlight-table" style={{ width: '100%', tableLayout: 'fixed' }} id="scan-highlight-section-capture">
          <colgroup>
            {Array.from({ length: 26 }, (_, i) => <col key={i} />)}
          </colgroup>
          <tbody>
            {/* 추천 섹션 제목 행 */}
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" colSpan={20}
                style={{ fontWeight: 700, fontSize: 12, color: 'var(--color-brand)' }}>
                참고용 추천 눌림목
                <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--color-text-tertiary)', marginLeft: 8 }}>
                  상단 참고 · 하단 실전 기준과 분리
                </span>
              </td>
              <td className="xls-cell" colSpan={6} style={{ textAlign: 'right', padding: '1px 4px' }}>
                {onNavigate && (
                  <Button variant="secondary" onClick={() => onNavigate('highlights')}>
                    하이라이트 허브
                  </Button>
                )}
              </td>
            </tr>
            {/* ── 추천 카드 ──
                각 카드 = colSpan(열 분할) × rowSpan(9행 × 22px = 198px)
                내용은 자연스럽게 위→아래 배치, height:100% 사용 안 함
            ── */}
            {(isMobileViewport ? activeHighlights.map((_, i) => i) : [0, 3]).map((startIdx) => {
              const rowCards = isMobileViewport
                ? activeHighlights.slice(startIdx, startIdx + 1)
                : activeHighlights.slice(startIdx, startIdx + 3)
              if (rowCards.length === 0) return null
              const count = rowCards.length
              const CARD_ROWS = isMobileViewport ? 7 : 9
              /* 열 균등 분배: 26열을 카드 수로 나눔 */
              const colsPerCard = Math.floor(26 / count)
              return (
                <React.Fragment key={`card-row-${startIdx}`}>
                  <tr>
                    {rowCards.map((c, i) => {
                      const rank = startIdx + i + 1
                      const isTop1 = rank === 1
                      const colSpan = i === count - 1 ? 26 - colsPerCard * i : colsPerCard
                      return (
                        <td
                          key={c.code}
                          className={`xls-cell scan-highlight-card-cell${isTop1 ? ' scan-highlight-card-cell--top' : ''}`}
                          colSpan={colSpan}
                          rowSpan={CARD_ROWS}
                          onClick={() => navigateToAnalyze(c.code)}
                          title={`${c.name} 참고용 상세 보기`}
                          style={{
                            verticalAlign: 'top',
                            cursor: 'pointer',
                            padding: '12px 14px',
                          }}
                        >
                          {/* ① 랭크 + 경고 뱃지 */}
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 6,
                          }}>
                            <span style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: isTop1 ? 'var(--color-brand)' : 'var(--color-text-tertiary)',
                              letterSpacing: '0.05em',
                            }}>
                              TOP {rank}
                            </span>
                            <WarnBadge grade={c.warn_grade} />
                          </div>

                          {/* ② 종목명 */}
                          <div style={{
                            fontWeight: 700,
                            fontSize: 15,
                            color: 'var(--color-text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginBottom: 2,
                          }}>
                            {c.name}
                          </div>

                          {/* ③ 종목코드 */}
                          <div style={{
                            fontSize: 11,
                            color: 'var(--color-text-tertiary)',
                            fontFamily: 'var(--font-family-mono)',
                            marginBottom: 10,
                          }}>
                            {c.code}
                          </div>

                          {/* ④ 등급 뱃지 */}
                          <div style={{
                            display: 'flex',
                            gap: 5,
                            flexWrap: 'wrap',
                            marginBottom: 8,
                          }}>
                            <GradeBadge grade={c.entry_grade} label="진입" />
                            <GradeBadge grade={c.trend_grade} label="추세" />
                            <GradeBadge grade={c.dist_grade} label="매집" />
                            {c.pivot_grade && <GradeBadge grade={c.pivot_grade} label="세력" />}
                            {c.signal && <SignalBadge signal={c.signal} />}
                          </div>

                          {/* ⑤ 섹터 · 진입점수 */}
                          <div style={{
                            fontSize: 11,
                            color: 'var(--color-text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginBottom: 10,
                          }}>
                            {[
                              c.sector_id,
                              c.entry_score != null ? `진입 ${formatNumber(c.entry_score, 1)}` : null,
                            ].filter(Boolean).join(' · ')}
                          </div>

                          {/* ⑥ 상세 링크 힌트 */}
                          <div style={{
                            fontSize: 11,
                            color: 'var(--color-brand)',
                            fontWeight: 500,
                          }}>
                            참고용 상세 분석 →
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                  {/* rowSpan 채우는 더미 행 */}
                  {Array.from({ length: CARD_ROWS - 1 }, (_, ri) => (
                    <tr key={`spacer-${startIdx}-${ri}`} style={{ height: 22 }} />
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      {/* 전체 목록 */}
      {loading && candidates.length === 0 ? (
        <div className="card"><Skeleton lines={6} height={16} /></div>
      ) : !error && sortedCandidates.length === 0 ? (
        <EmptyState title="스캔 결과 없음" description="스캔을 실행하거나 필터를 조정해 보세요." />
      ) : (
        <div id="scan-candidates-section-capture" className="scan-candidates-section">
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
            <div className="scan-table-wrap xls-scroll-frame" style={{ ['--xls-table-min-width' as any]: '1280px' }}>
            <table className="xls-table scan-table scan-candidates-table" style={{ width: 'max-content', tableLayout: 'auto', minWidth: 1280 }}>
              <thead>
                <tr className="xls-header-row">
                  <th className="xls-th">{renderSortableHeader('코드', 'code')}</th>
                  <th className="xls-th">{renderSortableHeader('종목명', 'name')}</th>
                  <th className="xls-th">{renderSortableHeader('섹터', 'sector_id')}</th>
                  <th className="xls-th">{renderSortableHeader('우선순위▼', 'priority_score')}</th>
                  <th className="xls-th">{renderSortableHeader('선행매집', 'lead_accumulation_score')}</th>
                  <th className="xls-th">{renderSortableHeader('진입', 'entry_grade')}</th>
                  <th className="xls-th">{renderSortableHeader('진입점수', 'entry_score')}</th>
                  <th className="xls-th">{renderSortableHeader('추세', 'trend_grade')}</th>
                  <th className="xls-th">{renderSortableHeader('매집', 'dist_grade')}</th>
                  <th className="xls-th">{renderSortableHeader('세력선', 'pivot_grade')}</th>
                  <th className="xls-th">{renderSortableHeader('경고', 'warn_score')}</th>
                  <th className="xls-th">{renderSortableHeader('유동성', 'liquidity')}</th>
                  <th className="xls-th">{renderSortableHeader('변동(%)', 'intraday_change_pct')}</th>
                  <th className="xls-th">{renderSortableHeader('기준일', 'trade_date')}</th>
                  <th className="xls-th">관리</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((s: any, idx: number) => {
                  const code = String(s.code)
                  const isAdded = isWatched(code)
                  const isAddingNow = isAdding(code)
                  const isRemovingNow = isRemoving(code)
                  const isMutating = isAddingNow || isRemovingNow
                  /* 진입 등급별 코드 셀 색상 */
                  const codeColor = getEntryLevel(s.entry_grade) === 'a'
                    ? 'var(--color-success)'
                    : getEntryLevel(s.entry_grade) === 'b'
                      ? 'var(--color-brand)'
                      : 'var(--color-text-secondary)'
                  return (
                    <tr
                      key={s.code}
                      className={`xls-row${idx % 2 === 1 ? ' xls-row--even' : ''}`}
                      onClick={() => navigateToAnalyze(code)}
                      style={{ cursor: 'pointer' }}
                      title={`${s.name} 상세 분석`}
                    >
                      {/* 코드 */}
                      <td className="xls-cell" style={{ fontFamily: 'var(--font-family-mono)', fontSize: 11, color: codeColor, fontWeight: 600 }}>
                        {s.code}
                      </td>
                      {/* 종목명 — 말줄임 */}
                      <td className="xls-cell" title={s.name} style={{ fontWeight: 500 }}>
                        {s.name}
                      </td>
                      {/* 섹터 — 말줄임 */}
                      <td className="xls-cell" title={s.sector_id ?? ''} style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        {s.sector_id ?? '—'}
                      </td>
                      {/* 우선순위 */}
                      <td className="xls-cell xls-cell--num" title="진입점수×20 − 경고점수×3 + 장중 현재가 보정">
                        <span className={s.priorityScore >= 60 ? 'scan-grade-badge scan-grade-a' : s.priorityScore >= 40 ? 'scan-grade-badge scan-grade-b' : 'scan-grade-label'}>
                          {formatNumber(s.priorityScore, 1)}
                        </span>
                      </td>
                      {/* 선행매집 */}
                      <td className="xls-cell xls-cell--num">
                        <span className={s.leadAccumulationScore >= 75 ? 'scan-grade-badge scan-grade-a' : s.leadAccumulationScore >= 55 ? 'scan-grade-badge scan-grade-b' : 'scan-grade-label'}>
                          {formatNumber(s.leadAccumulationScore, 0)}
                        </span>
                      </td>
                      {/* 진입 */}
                      <td className="xls-cell"><GradeBadge grade={s.entry_grade} /></td>
                      {/* 진입점수 */}
                      <td className="xls-cell xls-cell--num" style={{ fontSize: 11 }}>
                        {s.entry_score != null ? formatNumber(s.entry_score, 2) : '—'}
                      </td>
                      {/* 추세 */}
                      <td className="xls-cell"><GradeBadge grade={s.trend_grade} /></td>
                      {/* 매집 */}
                      <td className="xls-cell">
                        <GradeBadge grade={s.dist_grade} />
                        {s.dist_pct != null && (
                          <span className="scan-grade-label" style={{ fontSize: 10 }}> ({formatNumber(s.dist_pct, 1)}%)</span>
                        )}
                      </td>
                      {/* 세력선 */}
                      <td className="xls-cell">
                        <GradeBadge grade={s.pivot_grade} />
                        {s.vol_atr_grade && (
                          <span className="scan-grade-label" style={{ fontSize: 10 }}> /{s.vol_atr_grade}</span>
                        )}
                      </td>
                      {/* 경고 */}
                      <td className="xls-cell">
                        <WarnBadge grade={s.warn_grade} />
                      </td>
                      {/* 유동성 */}
                      <td className="xls-cell xls-cell--num" style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        {s.liquidity != null ? formatNumber(s.liquidity, 0) : '—'}
                      </td>
                      {/* 변동(%) */}
                      <td className="xls-cell xls-cell--num">
                        {typeof s.intradayChangePct === 'number' ? (
                          <span style={{
                            color: s.intradayChangePct > 0 ? 'var(--color-stock-up)' : s.intradayChangePct < 0 ? 'var(--color-stock-down)' : undefined,
                            fontWeight: 600, fontSize: 11,
                          }}>
                            {s.intradayChangePct > 0 ? '+' : ''}{formatNumber(s.intradayChangePct, 2)}%
                          </span>
                        ) : '—'}
                      </td>
                      {/* 기준일 — 단일 행 말줄임 */}
                      <td className="xls-cell" style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        {s.tradeDateText}
                      </td>
                      {/* 관리 */}
                      <td className="xls-cell" onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                          <Button
                            variant="ghost"
                            onClick={(e: React.MouseEvent) => onToggleWatchlist(e, code)}
                            disabled={isMutating}
                            title={isAdded ? '관심 종목에서 제거' : '관심 종목에 추가'}
                            style={{ fontSize: 11, padding: '1px 6px' }}
                          >
                            {isAdded ? '⊖제거' : '⊕추가'}
                          </Button>
                        </div>
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
    </div>
  )
}
