import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { apiFetch, invalidateCache } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Skeleton from '../../components/Skeleton'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/Modal'
import { EmptyState, ErrorState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
import Pagination from '../../components/Pagination'

type PortfolioShareHistoryItem = {
  shareId: string
  url: string
  expiresAt: string
  createdAt?: string
  revokedAt?: string | null
  accessCount?: number
  lastAccessedAt?: string | null
}

function pickLatestActiveShare(items: PortfolioShareHistoryItem[]): PortfolioShareHistoryItem | null {
  const now = Date.now()
  for (const item of items) {
    const expired = new Date(item.expiresAt).getTime() <= now
    if (!item.revokedAt && !expired) return item
  }
  return null
}

export default function Portfolio() {
  const [allRows, setAllRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedSector, setSelectedSector] = useState<string | null>(null)
  const [holdingStateFilter, setHoldingStateFilter] = useState<'all' | 'hold' | 'add' | 'partial'>('all')
  const [gradeFilter, setGradeFilter] = useState<'all' | 'A' | 'B' | 'C'>('all')
  const [gradeAThreshold, setGradeAThreshold] = useState(80)
  const [gradeBThreshold, setGradeBThreshold] = useState(65)
  const [addEntryMinScore, setAddEntryMinScore] = useState(70)
  const [partialTakeProfitPct, setPartialTakeProfitPct] = useState(8)
  const [showAllSectors, setShowAllSectors] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalRow, setModalRow] = useState<any | null>(null)
  const [modalSide, setModalSide] = useState<'buy' | 'sell'>('buy')
  const [tradeQty, setTradeQty] = useState(1)
  const [tradePrice, setTradePrice] = useState<number | ''>('')
  const [tradeLoading, setTradeLoading] = useState(false)
  const [tradeError, setTradeError] = useState<string | null>(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [sharedSummaryUrl, setSharedSummaryUrl] = useState('')
  const [shareExpiresAt, setShareExpiresAt] = useState('')
  const [shareTtlHours, setShareTtlHours] = useState<number>(48)
  const [shareCreating, setShareCreating] = useState(false)
  const [shareHistory, setShareHistory] = useState<PortfolioShareHistoryItem[]>([])
  const [shareHistoryLoading, setShareHistoryLoading] = useState(false)
  const [revokingShareId, setRevokingShareId] = useState('')
  const [deletingShareId, setDeletingShareId] = useState('')
  const [maintModalOpen, setMaintModalOpen] = useState(false)
  const [maintMode, setMaintMode] = useState<'liquidateall' | 'holdingedit' | 'holdingrestore'>('holdingrestore')
  const [maintRow, setMaintRow] = useState<any | null>(null)
  const [maintCode, setMaintCode] = useState('')
  const [maintBuyPrice, setMaintBuyPrice] = useState<number | ''>('')
  const [maintQty, setMaintQty] = useState<number>(1)
  const [maintLoading, setMaintLoading] = useState(false)
  const [maintError, setMaintError] = useState<string | null>(null)
  const toast = useToast()

  const safeGradeAThreshold = Math.max(1, Math.min(100, Number(gradeAThreshold || 80)))
  const safeGradeBThreshold = Math.max(0, Math.min(safeGradeAThreshold - 1, Number(gradeBThreshold || 65)))
  const safeAddEntryMinScore = Math.max(0, Math.min(100, Number(addEntryMinScore || 70)))
  const safePartialTakeProfitPct = Math.max(0, Math.min(50, Number(partialTakeProfitPct || 8)))

  const getScoreValue = (row: any): number | null => {
    const score = Number(row?.total_score)
    return Number.isFinite(score) ? score : null
  }

  const getHoldingState = (row: any): 'hold' | 'add' | 'partial' => {
    const pct = Number(row?.unrealized_pct)
    if (Number.isFinite(pct) && pct >= safePartialTakeProfitPct) return 'partial'

    const score = getScoreValue(row)
    const hasAddSignal = Number(row?.recommended_buy_qty || 0) > 0
    if (hasAddSignal && (score == null || score >= safeAddEntryMinScore)) return 'add'

    return 'hold'
  }

  const getPerformanceGrade = (row: any): 'A' | 'B' | 'C' => {
    const score = getScoreValue(row)
    if (score == null) return 'C'
    if (score >= safeGradeAThreshold) return 'A'
    if (score >= safeGradeBThreshold) return 'B'
    return 'C'
  }

  const load = useCallback(async ({ soft = false, force = false }: { soft?: boolean; force?: boolean } = {}) => {
    setRefreshing(true)
    if (!soft) setLoading(true)
    if (!soft) setError(null)
    try {
      // 초기 로드 pageSize를 20으로 제한 → 초기 응답 시간 8초에서 1초 이하로 단축
      const params = new URLSearchParams({ page: '1', pageSize: '20', includeLots: '0', positionType: 'holding' })
      if (force) params.set('cacheMs', '0')
      const json = await apiFetch(`/api/ui/positions?${params}`, { cacheMs: 3_000, timeoutMs: 15_000, retries: 1 })
      setAllRows(json?.data ?? [])
      setLastUpdatedAt(Date.now())
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (!soft) setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 클라이언트 사이드 파생 상태 – API 재호출 없이 즉시 필터링
  const holdingAll = useMemo(() => allRows.filter((r: any) => r.position_type === 'holding'), [allRows])

  const sectors = useMemo(() => {
    const base = holdingAll
    const seen = new Map<string, { id: string; name: string }>()
    for (const r of base) {
      const s = r.stock?.sector
      if (s?.id && s?.name && !seen.has(String(s.id))) {
        seen.set(String(s.id), { id: String(s.id), name: String(s.name) })
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [holdingAll])

  const filteredRows = useMemo(() => {
    let result: any[] = holdingAll
    if (selectedSector) result = result.filter((r: any) => String(r.stock?.sector_id ?? '') === selectedSector)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((r: any) =>
        (r.code || '').toLowerCase().includes(q) ||
        (r.stock_name || '').toLowerCase().includes(q)
      )
    }

    if (holdingStateFilter !== 'all') {
      result = result.filter((r: any) => getHoldingState(r) === holdingStateFilter)
    }

    if (gradeFilter !== 'all') {
      result = result.filter((r: any) => getPerformanceGrade(r) === gradeFilter)
    }

    return result
  }, [holdingAll, selectedSector, search, holdingStateFilter, gradeFilter, safePartialTakeProfitPct, safeAddEntryMinScore, safeGradeAThreshold, safeGradeBThreshold])

  const total = filteredRows.length
  const totalPages = Math.ceil(total / pageSize)
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
  const totalUnrealized = holdingAll.reduce((acc: number, r: any) => acc + Number(r.unrealized_pnl || 0), 0)
  const totalInvested = holdingAll.reduce((acc: number, r: any) => acc + (Number(r.quantity || 0) * Number(r.avg_price || 0)), 0)
  const totalReturnPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0
  const captureGeneratedAt = useMemo(
    () => new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date()),
    [shareModalOpen],
  )

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSearchChange = (v: string) => {
    setSearchInput(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(v)
      setPage(1)
    }, 220)
  }
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const openTradeModal = (row: any, side: 'buy' | 'sell') => {
    setModalRow(row)
    setModalSide(side)
    setTradeQty(side === 'buy' ? (row.recommended_buy_qty || 1) : (row.quantity || 1))
    setTradePrice(row.stock?.close ?? row.avg_price ?? '')
    setTradeError(null)
    setModalOpen(true)
  }

  const openMaintenanceModal = (mode: 'liquidateall' | 'holdingedit' | 'holdingrestore', row?: any) => {
    setMaintMode(mode)
    setMaintRow(row ?? null)
    setMaintError(null)
    if (mode === 'holdingedit') {
      const code = String(row?.code || '')
      setMaintCode(code)
      setMaintBuyPrice(Number(row?.avg_price || row?.buy_price || row?.stock?.close || 0) || '')
      setMaintQty(Math.max(1, Number(row?.quantity || 1)))
    }
    if (mode === 'holdingrestore') {
      setMaintCode('')
      setMaintBuyPrice('')
      setMaintQty(1)
    }
    setMaintModalOpen(true)
  }

  const runMaintenance = async () => {
    setMaintLoading(true)
    setMaintError(null)
    try {
      const body: any = { mode: maintMode }
      if (maintMode === 'holdingedit' || maintMode === 'holdingrestore') {
        body.code = maintCode
        body.buy_price = maintBuyPrice
        body.quantity = maintQty
      }

      const json = await apiFetch('/api/ui/positions-maintenance', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 20_000,
        body: JSON.stringify(body),
      })
      if (json?.error) throw new Error(String(json.error))

      if (maintMode === 'liquidateall') {
        toast.show(`보유 종목 ${Number(json?.soldCount || 0)}건 전체매도 처리 완료`)
      } else if (maintMode === 'holdingrestore') {
        const label = json?.data?.stock_name || json?.data?.code || maintCode
        const action = json?.created ? '신규 복구' : '기존 포지션 수정'
        toast.show(`${label} 보유복구(${action}) 완료 ✓`)
      } else {
        toast.show('보유수정 완료 ✓')
      }

      invalidateCache('/api/ui/positions')
      setMaintModalOpen(false)
      await load({ soft: true, force: true })
    } catch (e: any) {
      setMaintError(String(e?.message || e))
    } finally {
      setMaintLoading(false)
    }
  }

  const submitTrade = async () => {
    if (!modalRow) return
    if (!tradeQty || tradeQty <= 0) { setTradeError('수량은 1 이상이어야 합니다'); return }
    if (tradePrice !== '' && Number(tradePrice) <= 0) { setTradeError('가격은 0보다 커야 합니다'); return }

    setTradeLoading(true)
    setTradeError(null)
    try {
      const payload = {
        code: modalRow.code,
        side: modalSide === 'buy' ? 'BUY' : 'SELL',
        quantity: Number(tradeQty),
        price: tradePrice !== '' ? Number(tradePrice) : (modalRow.stock?.close ?? modalRow.avg_price ?? 0),
      }
      const json = await apiFetch('/api/ui/virtual-trade', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify(payload),
      })
      if (json?.error) {
        setTradeError(String(json?.error || '거래 실행 실패'))
      } else {
        toast.show(`${modalSide === 'buy' ? '매수' : '매도'} 등록 완료 ✓`)
        invalidateCache('/api/ui/positions')
        setModalOpen(false)
        load({ soft: true, force: true })
      }
    } catch (e: any) {
      setTradeError(String(e?.message || e))
    } finally {
      setTradeLoading(false)
    }
  }

  const visibleSectors = showAllSectors ? sectors : sectors.slice(0, 8)

  const onSectorChange = (sectorId: string | null) => {
    setSelectedSector(sectorId)
    setPage(1)
  }

  const formatSignedKrw = (value: number) => {
    const num = Number(value || 0)
    if (num === 0) return formatKrw(0)
    return `${num > 0 ? '+' : '-'}${formatKrw(Math.abs(num))}`
  }

  const createPublicShareUrl = useCallback(async () => {
    if (shareCreating) return
    setShareCreating(true)
    try {
      const json = await apiFetch('/api/ui/portfolio-share', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify({ ttlHours: shareTtlHours }),
      })
      const url = String(json?.url || '')
      if (!url) throw new Error('공유 URL 생성에 실패했습니다')
      setSharedSummaryUrl(url)
      setShareExpiresAt(String(json?.expiresAt || ''))
      toast.show('공유 URL이 생성되었습니다')
      invalidateCache('/api/ui/portfolio-share')
      const historyJson = await apiFetch('/api/ui/portfolio-share?all=1&limit=10', {
        cacheMs: 0,
        timeoutMs: 10_000,
      })
      setShareHistory(Array.isArray(historyJson?.data) ? historyJson.data : [])
    } catch (e: any) {
      toast.show(String(e?.message || e || '공유 URL 생성 실패'))
    } finally {
      setShareCreating(false)
    }
  }, [shareCreating, shareTtlHours, toast])

  const loadShareHistory = useCallback(async (opts?: { silent?: boolean }) => {
    setShareHistoryLoading(true)
    try {
      const json = await apiFetch('/api/ui/portfolio-share?all=1&limit=10', {
        cacheMs: 0,
        timeoutMs: 10_000,
      })
      const list = Array.isArray(json?.data) ? json.data : []
      setShareHistory(list)
      return list as PortfolioShareHistoryItem[]
    } catch (e: any) {
      if (!opts?.silent) toast.show(String(e?.message || e || '공유 이력 조회 실패'))
      return [] as PortfolioShareHistoryItem[]
    } finally {
      setShareHistoryLoading(false)
    }
  }, [toast])

  const revokeShare = useCallback(async (shareId: string) => {
    if (!shareId || revokingShareId) return
    setRevokingShareId(shareId)
    try {
      const json = await apiFetch('/api/ui/portfolio-share', {
        method: 'DELETE',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ shareId }),
      })
      if (json?.error) throw new Error(String(json.error))
      toast.show('공유 링크를 철회했습니다')
      if (sharedSummaryUrl) {
        const target = shareHistory.find((item) => item.shareId === shareId)
        if (target?.url === sharedSummaryUrl) {
          setSharedSummaryUrl('')
          setShareExpiresAt('')
        }
      }
      const updated = await loadShareHistory()
      const active = pickLatestActiveShare(updated)
      if (active?.url) {
        setSharedSummaryUrl(active.url)
        setShareExpiresAt(String(active.expiresAt || ''))
      } else {
        setSharedSummaryUrl('')
        setShareExpiresAt('')
      }
    } catch (e: any) {
      toast.show(String(e?.message || e || '공유 링크 철회 실패'))
    } finally {
      setRevokingShareId('')
    }
  }, [revokingShareId, toast, sharedSummaryUrl, shareHistory, loadShareHistory])

  const deleteShare = useCallback(async (shareId: string) => {
    if (!shareId || deletingShareId) return
    const ok = window.confirm('이 공유 기록을 목록에서 삭제할까요? 삭제 후 복구할 수 없습니다.')
    if (!ok) return

    setDeletingShareId(shareId)
    try {
      const json = await apiFetch('/api/ui/portfolio-share', {
        method: 'DELETE',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ shareId, hard: true }),
      })
      if (json?.error) throw new Error(String(json.error))

      toast.show('공유 기록을 삭제했습니다')
      const updated = await loadShareHistory()
      const active = pickLatestActiveShare(updated)
      if (active?.url) {
        setSharedSummaryUrl(active.url)
        setShareExpiresAt(String(active.expiresAt || ''))
      } else {
        setSharedSummaryUrl('')
        setShareExpiresAt('')
      }
    } catch (e: any) {
      toast.show(String(e?.message || e || '공유 기록 삭제 실패'))
    } finally {
      setDeletingShareId('')
    }
  }, [deletingShareId, toast, loadShareHistory])

  const copyPortfolioShareUrl = async () => {
    if (!sharedSummaryUrl) {
      toast.show('먼저 공유 URL을 생성해 주세요')
      return
    }
    try {
      await navigator.clipboard.writeText(sharedSummaryUrl)
      toast.show('공유 URL을 복사했습니다')
    } catch {
      toast.show('공유 URL 복사에 실패했습니다')
    }
  }

  useEffect(() => {
    if (!shareModalOpen) return

    let cancelled = false
    ;(async () => {
      const history = await loadShareHistory({ silent: true })
      if (cancelled) return

      const active = pickLatestActiveShare(history)
      if (active?.url) {
        setSharedSummaryUrl(active.url)
        setShareExpiresAt(String(active.expiresAt || ''))
        return
      }

      if (!shareCreating) {
        await createPublicShareUrl()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [shareModalOpen, shareCreating, createPublicShareUrl, loadShareHistory])

  return (
    <section className="container-app portfolio-page">
      <div className="portfolio-head">
        <div className="portfolio-title-wrap">
          <h1 className="title-xl portfolio-title">가상 포트폴리오</h1>
          <p className="portfolio-subtitle">보유 포지션만 집중해서 관리합니다.</p>
        </div>
        <div className="portfolio-head-actions">
          <span className="caption muted portfolio-head-updated">
            {refreshing
              ? '업데이트 중...'
              : `마지막 갱신 ${lastUpdatedAt
                ? new Date(lastUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '-'}`}
          </span>

          <div className="portfolio-head-primary-actions">
            <Button variant="secondary" onClick={() => load({ force: true })} disabled={loading || refreshing}>
              {refreshing ? '새로고침 중...' : '새로고침'}
            </Button>
            <span className="portfolio-total-pill">
              {allRows.length > 0 ? `총 ${allRows.length}개` : '포지션 집계 준비중'}
            </span>
            <Button variant="secondary" onClick={() => setShareModalOpen(true)} disabled={loading || holdingAll.length === 0}>공유 요약 보기</Button>
          </div>

          <div className="portfolio-head-text-actions" role="group" aria-label="포트폴리오 유지보수 작업">
            <button
              type="button"
              className="portfolio-text-action"
              onClick={() => openMaintenanceModal('holdingrestore')}
              disabled={loading}
            >
              보유복구
            </button>
            <button
              type="button"
              className="portfolio-text-action"
              onClick={() => openMaintenanceModal('liquidateall')}
              disabled={loading || holdingAll.length === 0}
            >
              전체매도
            </button>
          </div>
        </div>
      </div>

      <div className="portfolio-stat-grid">
        <div className="card portfolio-stat-card">
          <div className="stat-label">보유 종목</div>
          <div className="stat-value">{holdingAll.length}</div>
          <div className="stat-sub">실제 보유 상태</div>
        </div>
        <div className="card portfolio-stat-card">
          <div className="stat-label">현재 실제 매수금</div>
          <div className="stat-value">{formatKrw(totalInvested)}</div>
          <div className="stat-sub">보유 수량×평균 매수가</div>
        </div>
        <div className="card portfolio-stat-card">
          <div className="stat-label">평가손익 합계</div>
          <div className={`stat-value ${totalUnrealized < 0 ? 'negative' : 'positive'}`}>
            {formatKrw(totalUnrealized)}
          </div>
          <div className="stat-sub">보유 포지션 기준</div>
        </div>
      </div>

      {/* 필터 */}
      <div className="card mb-4 portfolio-filter-card">
        <div className="portfolio-filter-stack">
          <div>
            <div className="caption portfolio-filter-label">섹터</div>
            <div className="tag-list">
              <button
                className={`tag${!selectedSector ? ' active' : ''}`}
                onClick={() => onSectorChange(null)}
              >전체</button>
              {visibleSectors.map((s: any) => (
                <button
                  key={s.id}
                  className={`tag${selectedSector === s.id ? ' active' : ''}`}
                  onClick={() => onSectorChange(s.id)}
                >{s.name}</button>
              ))}
              {sectors.length > 8 && (
                <button className="tag" onClick={() => setShowAllSectors(v => !v)}>
                  {showAllSectors ? '접기' : `+ ${sectors.length - 8}개 더보기`}
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="caption portfolio-filter-label">보유 상태</div>
            <div className="tag-list portfolio-segment-list">
              <button
                className={`tag${holdingStateFilter === 'all' ? ' active' : ''}`}
                onClick={() => { setHoldingStateFilter('all'); setPage(1) }}
              >
                전체
              </button>
              <button
                className={`tag${holdingStateFilter === 'hold' ? ' active' : ''}`}
                onClick={() => { setHoldingStateFilter('hold'); setPage(1) }}
              >
                보통 보유(홀드)
              </button>
              <button
                className={`tag${holdingStateFilter === 'add' ? ' active' : ''}`}
                onClick={() => { setHoldingStateFilter('add'); setPage(1) }}
              >
                추가매수(IN진입)
              </button>
              <button
                className={`tag${holdingStateFilter === 'partial' ? ' active' : ''}`}
                onClick={() => { setHoldingStateFilter('partial'); setPage(1) }}
              >
                부분청산 후보
              </button>
            </div>
          </div>

          <div>
            <div className="caption portfolio-filter-label">성과 등급</div>
            <div className="tag-list portfolio-segment-list">
              <button
                className={`tag${gradeFilter === 'all' ? ' active' : ''}`}
                onClick={() => { setGradeFilter('all'); setPage(1) }}
              >
                전체
              </button>
              <button
                className={`tag${gradeFilter === 'A' ? ' active' : ''}`}
                onClick={() => { setGradeFilter('A'); setPage(1) }}
              >
                A (점수 {safeGradeAThreshold} 이상)
              </button>
              <button
                className={`tag${gradeFilter === 'B' ? ' active' : ''}`}
                onClick={() => { setGradeFilter('B'); setPage(1) }}
              >
                B (점수 {safeGradeBThreshold}~{safeGradeAThreshold - 1})
              </button>
              <button
                className={`tag${gradeFilter === 'C' ? ' active' : ''}`}
                onClick={() => { setGradeFilter('C'); setPage(1) }}
              >
                C (점수 {safeGradeBThreshold - 1} 이하)
              </button>
            </div>
          </div>

          <div>
            <div className="caption portfolio-filter-label">기준값 조정</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-2)' }}>
              <Input
                label="A 등급 점수"
                type="number"
                value={String(gradeAThreshold)}
                onChange={(e: any) => setGradeAThreshold(Number(e?.target?.value || 80))}
              />
              <Input
                label="B 등급 점수"
                type="number"
                value={String(gradeBThreshold)}
                onChange={(e: any) => setGradeBThreshold(Number(e?.target?.value || 65))}
              />
              <Input
                label="추가매수 최소 점수"
                type="number"
                value={String(addEntryMinScore)}
                onChange={(e: any) => setAddEntryMinScore(Number(e?.target?.value || 70))}
              />
              <Input
                label="부분청산 후보 수익률(%)"
                type="number"
                value={String(partialTakeProfitPct)}
                onChange={(e: any) => setPartialTakeProfitPct(Number(e?.target?.value || 8))}
              />
            </div>
            <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
              등급은 종목 점수(total_score), 상태는 점수/수익률/추가매수 신호를 기준으로 자동 분류됩니다.
            </div>
          </div>

          <div className="portfolio-search-row">
            <input
              className="input portfolio-search-input"
              placeholder="코드 또는 종목명 검색"
              value={searchInput}
              onChange={e => onSearchChange(e.target.value)}
            />
            <Button className="portfolio-search-btn" variant="secondary" onClick={() => { setSearch(searchInput); setPage(1) }} disabled={loading}>
              검색
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="portfolio-error-wrap">
          <ErrorState message={error} onRetry={() => load({ force: true })} />
        </div>
      )}

      <div className="cards-list portfolio-cards-list">
        {loading && rows.length === 0 && <div className="card portfolio-loading-card"><Skeleton lines={5} height={18} /></div>}

        {!loading && !error && rows.length === 0 && (
          <EmptyState
            title="보유 포지션 없음"
            description="텔레그램 /가상매수 또는 아래 버튼으로 보유 포지션을 추가하세요."
          />
        )}

        {!error && rows.map((r: any) => {
          const pnl = r.unrealized_pnl
          const holdingState = getHoldingState(r)
          const grade = getPerformanceGrade(r)
          const score = getScoreValue(r)
          const scoreSignal = String(r?.score_signal || '').trim().toUpperCase()
          return (
            <div key={r.id} className="card card-lg portfolio-position-card">
              <div className="flex-between portfolio-position-top">
                <div>
                  <div className="title-lg">{r.stock_name ?? r.ticker ?? r.symbol}</div>
                  <div className="caption">{r.code}</div>
                  <div className="muted portfolio-position-meta">
                    {r.quantity}주 · 매수가 {formatKrw(r.avg_price)}
                    {r.buy_date ? ` · ${r.buy_date}` : ''}
                  </div>
                  <div className="caption" style={{ marginTop: '4px' }}>
                    상태: {holdingState === 'partial' ? '부분청산 후보' : holdingState === 'add' ? '추가매수(IN진입)' : '보통 보유(홀드)'}
                    {' · '}등급 {grade}
                    {' · '}점수 {score != null ? formatNumber(score, 1) : '—'}
                    {scoreSignal ? ` · 신호 ${scoreSignal}` : ''}
                  </div>
                </div>

                <div className="text-right portfolio-position-pnl">
                  <>
                    <div
                      className={pnl != null ? (pnl < 0 ? 'negative' : 'positive') : ''}
                      style={{ fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-xl)' }}
                    >
                      {pnl != null ? formatKrw(pnl) : '—'}
                    </div>
                    <div className="caption">
                      {r.unrealized_pct != null ? `${formatNumber(r.unrealized_pct, 2)}%` : '—'}
                      {r.hold_days != null ? ` · ${r.hold_days}일` : ''}
                    </div>
                  </>
                </div>
              </div>

              {r.lots?.length > 0 && (
                <div className="caption portfolio-lots">
                  로트: {r.lots.map((l: any) => `${l.acquired_quantity}주 @${formatKrw(l.acquired_price)}`).join(' · ')}
                </div>
              )}

              <div className="portfolio-actions-row">
                <Button className="portfolio-action-btn" variant="secondary" onClick={() => openTradeModal(r, 'buy')}>가상매수</Button>
                <Button className="portfolio-action-btn" variant="secondary" onClick={() => openMaintenanceModal('holdingedit', r)}>보유수정</Button>
                <Button className="portfolio-action-btn" variant="ghost" onClick={() => openTradeModal(r, 'sell')}>가상매도</Button>
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="pagination-wrap">
          <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        title={`가상${modalSide === 'buy' ? '매수' : '매도'}`}
        onClose={() => setModalOpen(false)}
        size="sm"
      >
        {modalRow && (
          <>
            <div className="muted" style={{ marginBottom: 'var(--space-4)' }}>
              <strong style={{ color: 'var(--color-text-primary)' }}>
                {modalRow.stock_name ?? modalRow.code}
              </strong>
              <span className="caption"> ({modalRow.code})</span>
            </div>

            <div className="grid-two" style={{ marginBottom: 'var(--space-4)' }}>
              <Input
                label="수량"
                type="number"
                value={String(tradeQty)}
                onChange={(e: any) => setTradeQty(Number(e.target.value))}
              />
              <Input
                label="가격 (미입력 시 현재가)"
                type="number"
                value={tradePrice === '' ? '' : String(tradePrice)}
                onChange={(e: any) => setTradePrice(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>

            {tradeError && (
              <div className="state-error" style={{ marginBottom: 'var(--space-3)' }}>
                <div className="state-error-title">{tradeError}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant="primary" onClick={submitTrade} disabled={tradeLoading}>
                {tradeLoading ? '처리 중…' : '실행'}
              </Button>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>취소</Button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        isOpen={shareModalOpen}
        title="포트폴리오 공유 요약"
        onClose={() => setShareModalOpen(false)}
        size="lg"
      >
        <div className="portfolio-capture-card">
          <div className="portfolio-capture-top">
            <div>
              <div className="portfolio-capture-title">가상 포트폴리오 요약</div>
              <div className="portfolio-capture-time">기준시각 {captureGeneratedAt}</div>
            </div>
            <div className="portfolio-capture-count">보유 {holdingAll.length}종목</div>
          </div>

          <div className="portfolio-share-control-grid">
            <div className="portfolio-share-ttl-field">
              <div className="caption muted" style={{ marginBottom: 'var(--space-1)' }}>링크 만료</div>
              <select
                className="input"
                value={String(shareTtlHours)}
                onChange={(e) => setShareTtlHours(Number(e.target.value) || 48)}
                disabled={shareCreating}
              >
                <option value="24">24시간</option>
                <option value="48">48시간</option>
                <option value="168">7일</option>
              </select>
            </div>

            <div className="portfolio-share-url-block">
              <div className="caption muted portfolio-share-url-label">공유 URL (인증 없이 접근 가능)</div>
              <div className="portfolio-share-url-row">
                <input
                  className="ui-text portfolio-share-url-input"
                  readOnly
                  value={sharedSummaryUrl || (shareCreating ? '공유 URL 생성 중...' : '')}
                />
                <Button variant="secondary" onClick={createPublicShareUrl} disabled={shareCreating}>
                  {shareCreating ? '생성 중...' : 'URL 재생성'}
                </Button>
                <Button variant="secondary" onClick={copyPortfolioShareUrl} disabled={!sharedSummaryUrl}>URL 복사</Button>
              </div>
            </div>
          </div>
          {shareExpiresAt && (
            <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
              링크 만료: {new Date(shareExpiresAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
            </div>
          )}

          <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
            이 URL은 누구나 열람 가능한 공유 전용 단독 페이지입니다.
          </div>

          <div className="card" style={{ margin: 0, marginBottom: 'var(--space-3)', padding: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <div className="title-md">최근 공유 링크</div>
              <Button variant="secondary" onClick={() => { void loadShareHistory() }} disabled={shareHistoryLoading}>
                {shareHistoryLoading ? '조회 중...' : '새로고침'}
              </Button>
            </div>

            {shareHistory.length === 0 ? (
              <div className="caption muted">공유 이력이 없습니다.</div>
            ) : (
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {shareHistory.map((item) => {
                  const isRevoked = Boolean(item.revokedAt)
                  const isExpired = new Date(item.expiresAt).getTime() <= Date.now()
                  return (
                    <div key={item.shareId} className="portfolio-share-history-item">
                      <div className="portfolio-share-history-head">
                        <div className="caption">
                          생성 {item.createdAt ? new Date(item.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}
                          {' · '}만료 {new Date(item.expiresAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                          {' · '}조회 {Number(item.accessCount || 0)}회
                        </div>
                        <div className={`portfolio-share-history-status ${isRevoked ? 'is-revoked' : isExpired ? 'is-expired' : 'is-active'}`}>
                          {isRevoked ? '철회됨' : isExpired ? '만료됨' : '활성'}
                        </div>
                      </div>
                      <div className="portfolio-share-history-url">{item.url}</div>
                      <div className="portfolio-share-history-actions">
                        <Button
                          variant="secondary"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(String(item.url || ''))
                              toast.show('공유 URL을 복사했습니다')
                            } catch {
                              toast.show('공유 URL 복사에 실패했습니다')
                            }
                          }}
                        >
                          URL 복사
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => revokeShare(item.shareId)}
                          disabled={isRevoked || isExpired || revokingShareId === item.shareId || deletingShareId === item.shareId}
                        >
                          {isRevoked ? '철회됨' : isExpired ? '만료됨' : revokingShareId === item.shareId ? '철회 중...' : '철회'}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => deleteShare(item.shareId)}
                          disabled={revokingShareId === item.shareId || deletingShareId === item.shareId}
                        >
                          {deletingShareId === item.shareId ? '삭제 중...' : '삭제'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="portfolio-capture-metrics">
            <div className="portfolio-capture-metric">
              <div className="portfolio-capture-label">총 매수원금</div>
              <div className="portfolio-capture-value">{formatKrw(totalInvested)}</div>
            </div>
            <div className="portfolio-capture-metric">
              <div className="portfolio-capture-label">평가손익</div>
              <div className={`portfolio-capture-value ${totalUnrealized < 0 ? 'negative' : 'positive'}`}>
                {formatSignedKrw(totalUnrealized)}
              </div>
            </div>
            <div className="portfolio-capture-metric">
              <div className="portfolio-capture-label">현재 수익률</div>
              <div className={`portfolio-capture-value ${totalReturnPct < 0 ? 'negative' : 'positive'}`}>
                {`${totalReturnPct > 0 ? '+' : ''}${formatNumber(totalReturnPct, 2)}%`}
              </div>
            </div>
          </div>

          <div className="portfolio-capture-table-wrap">
            <table className="portfolio-capture-table">
              <thead>
                <tr>
                  <th>종목명</th>
                  <th>종목코드</th>
                  <th>보유수량</th>
                  <th>매수가</th>
                  <th>매수일</th>
                  <th>손익</th>
                  <th>수익률</th>
                </tr>
              </thead>
              <tbody>
                {holdingAll.map((r: any) => {
                  const pnl = Number(r.unrealized_pnl || 0)
                  const pct = Number(r.unrealized_pct || 0)
                  return (
                    <tr key={`capture-${r.id}`}>
                      <td>{r.stock_name ?? r.ticker ?? r.symbol ?? '-'}</td>
                      <td>{r.code || '-'}</td>
                      <td>{`${formatNumber(Number(r.quantity || 0), 0)}주`}</td>
                      <td>{formatKrw(Number(r.avg_price || 0))}</td>
                      <td>{r.buy_date || '-'}</td>
                      <td className={pnl < 0 ? 'negative' : pnl > 0 ? 'positive' : ''}>{formatSignedKrw(pnl)}</td>
                      <td className={pct < 0 ? 'negative' : pct > 0 ? 'positive' : ''}>{`${pct > 0 ? '+' : ''}${formatNumber(pct, 2)}%`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={maintModalOpen}
        title={
          maintMode === 'liquidateall' ? '전체매도' :
          maintMode === 'holdingrestore' ? '보유복구' :
          '보유수정'
        }
        onClose={() => setMaintModalOpen(false)}
        size="sm"
      >
        {maintMode === 'liquidateall' && (
          <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
            현재 보유 종목을 기준가로 일괄 매도 처리합니다. 실행 후 보유수량이 0으로 전환됩니다.
          </div>
        )}

        {maintMode === 'holdingedit' && (
          <>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              {maintRow?.stock_name || maintCode || '종목'}의 매수가/수량을 재설정합니다.
            </div>
            <div className="grid-two" style={{ marginBottom: 'var(--space-3)' }}>
              <Input label="종목코드" value={maintCode} onChange={(e: any) => setMaintCode(String(e?.target?.value || '').toUpperCase())} />
              <Input label="수량" type="number" value={String(maintQty)} onChange={(e: any) => setMaintQty(Math.max(1, Number(e?.target?.value || 1)))} />
            </div>
            <Input
              label="매수가"
              type="number"
              value={maintBuyPrice === '' ? '' : String(maintBuyPrice)}
              onChange={(e: any) => setMaintBuyPrice(e?.target?.value === '' ? '' : Number(e?.target?.value))}
            />
          </>
        )}

        {maintMode === 'holdingrestore' && (
          <>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              누락된 보유 포지션을 복구합니다. 기존 포지션이 있으면 덮어쓰고, 없으면 새로 생성합니다.
            </div>
            <div className="grid-two" style={{ marginBottom: 'var(--space-3)' }}>
              <Input
                label="종목코드"
                placeholder="예) 005930"
                value={maintCode}
                onChange={(e: any) => setMaintCode(String(e?.target?.value || '').toUpperCase())}
              />
              <Input
                label="수량"
                type="number"
                value={String(maintQty)}
                onChange={(e: any) => setMaintQty(Math.max(1, Number(e?.target?.value || 1)))}
              />
            </div>
            <Input
              label="매수가 (원)"
              type="number"
              placeholder="예) 75000"
              value={maintBuyPrice === '' ? '' : String(maintBuyPrice)}
              onChange={(e: any) => setMaintBuyPrice(e?.target?.value === '' ? '' : Number(e?.target?.value))}
            />
            <div className="caption muted" style={{ marginTop: 'var(--space-2)' }}>
              거래 이력에 ADJUST 로그가 기록됩니다.
            </div>
          </>
        )}

        {maintError && (
          <div className="state-error" style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <div className="state-error-title">{maintError}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <Button variant="primary" onClick={runMaintenance} disabled={maintLoading}>
            {maintLoading ? '처리 중…' : '실행'}
          </Button>
          <Button variant="ghost" onClick={() => setMaintModalOpen(false)}>취소</Button>
        </div>
      </Modal>
    </section>
  )
}
