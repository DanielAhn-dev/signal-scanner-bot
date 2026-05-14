import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { getStocks, invalidateStockCache } from '../../lib/stockCache'
import type { StockItem } from '../../lib/stockCache'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ToastProvider'
import Pagination from '../../components/Pagination'
import Skeleton from '../../components/Skeleton'
import Modal from '../../components/Modal'
import { EmptyState, ErrorState } from '../../components/StateViews'

type DetailSeriesRow = {
  date: string
  close: number | null
  high: number | null
  low: number | null
  open: number | null
  volume: number | null
  value: number | null
}

type DetailMeta = {
  latest: DetailSeriesRow | null
  profile: {
    market_cap?: number | null
    per?: number | null
    pbr?: number | null
    eps?: number | null
    bps?: number | null
    roe?: number | null
    debt_ratio?: number | null
    fundamentals_as_of?: string | null
    foreign_ratio?: number | null
  } | null
  flow: {
    date?: string | null
    foreign?: number | null
    institution?: number | null
  } | null
}

type SyncHistoryItem = {
  id: string
  kind: string
  status: 'running' | 'success' | 'failed'
  progress: number
  stage: string
  detail: string
  startedAt: string
  updatedAt: string
  finishedAt?: string
}

function asNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function formatDateKst(v: unknown): string {
  if (!v) return '—'
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatNumber(v: unknown, decimals?: number): string {
  const n = asNum(v)
  if (n == null) return '—'
  if (decimals != null) {
    return n.toLocaleString('ko-KR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }
  return n.toLocaleString('ko-KR')
}

function formatWon(v: unknown): string {
  const n = asNum(v)
  if (n == null) return '—'
  return `${n.toLocaleString('ko-KR')}원`
}

function normalizeSearchTerm(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·ㆍ\.\-_/()\[\]{}]/g, '')
}

export default function DBViewPage() {
  const [allStocks, setAllStocks] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [sectors, setSectors] = useState<any[]>([])
  const [selectedSector, setSelectedSector] = useState<string | null>(null)
  const [showAllSectors, setShowAllSectors] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [detailRow, setDetailRow] = useState<any | null>(null)
  const [detailData, setDetailData] = useState<DetailSeriesRow[] | null>(null)
  const [detailMeta, setDetailMeta] = useState<DetailMeta | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [syncModalOpen, setSyncModalOpen] = useState(false)
  const [syncTitle, setSyncTitle] = useState('')
  const [syncStage, setSyncStage] = useState('대기 중')
  const [syncDetail, setSyncDetail] = useState('')
  const [syncProgress, setSyncProgress] = useState(0)
  const [syncHistory, setSyncHistory] = useState<SyncHistoryItem[]>([])
  const toast = useToast()
  const syncPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopSyncPolling = () => {
    if (syncPollTimerRef.current) {
      clearInterval(syncPollTimerRef.current)
      syncPollTimerRef.current = null
    }
  }

  const startSyncProgress = (title: string) => {
    setSyncTitle(title)
    setSyncStage('요청 전송')
    setSyncDetail('서버에 동기화 작업을 요청했습니다.')
    setSyncProgress(3)
    setSyncModalOpen(true)
  }

  const finishSyncProgress = (doneStage: string, detail: string, success: boolean) => {
    stopSyncPolling()
    setSyncStage(doneStage)
    setSyncDetail(detail)
    setSyncProgress((prev) => Math.max(prev, success ? 100 : 95))
  }

  const loadSyncHistory = useCallback(async () => {
    try {
      const res = await apiFetch('/api/ui/sync-history?limit=8', { cacheMs: 0, timeoutMs: 10_000, retries: 0 })
      const list = Array.isArray(res?.data) ? res.data : []
      setSyncHistory(list)
    } catch {
      // ignore sync history load error
    }
  }, [])

  const beginSyncPolling = useCallback((syncId: string) => {
    stopSyncPolling()

    const poll = async () => {
      try {
        const status = await apiFetch(`/api/ui/sync-status?syncId=${encodeURIComponent(syncId)}`, {
          cacheMs: 0,
          timeoutMs: 10_000,
          retries: 0,
        })
        const item = status?.data as SyncHistoryItem | undefined
        if (!item) return

        setSyncStage(item.stage || '처리 중')
        setSyncDetail(item.detail || '')
        setSyncProgress(Math.max(0, Math.min(100, Number(item.progress || 0))))

        if (item.status === 'success' || item.status === 'failed') {
          stopSyncPolling()
          loadSyncHistory()
        }
      } catch {
        // polling errors are ignored to keep request flow alive
      }
    }

    void poll()
    syncPollTimerRef.current = setInterval(() => {
      void poll()
    }, 1200)
  }, [loadSyncHistory])

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      if (force) invalidateStockCache()
      const stocks = await getStocks()
      setAllStocks(stocks)
      setPage(1)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  // 클라이언트 사이드 필터링
  const filteredStocks = useMemo(() => {
    let result = allStocks
    if (appliedSearch) {
      const lower = normalizeSearchTerm(appliedSearch)
      result = result.filter(s =>
        normalizeSearchTerm(s.code).includes(lower) ||
        normalizeSearchTerm(s.name).includes(lower)
      )
    }
    if (selectedSector) {
      result = result.filter(s => s.sector_id === selectedSector)
    }
    return result
  }, [allStocks, appliedSearch, selectedSector])

  const total = filteredStocks.length
  const rows = useMemo(() => {
    const from = (page - 1) * pageSize
    return filteredStocks.slice(from, from + pageSize)
  }, [filteredStocks, page, pageSize])

  useEffect(() => {
    load(false)
  }, [load])

  useEffect(() => {
    ;(async () => {
      try {
        const s = await apiFetch('/api/ui/sectors', { cacheMs: 60_000, timeoutMs: 15_000, retries: 1 })
        setSectors(s.data ?? [])
      } catch { /* ignore */ }
    })()
  }, [])

  useEffect(() => {
    void loadSyncHistory()
  }, [loadSyncHistory])

  const applyFilters = () => {
    setAppliedSearch(searchInput)
    setPage(1)
  }

  const onSearchChange = (v: string) => {
    setSearchInput(v)
    setAppliedSearch(v)
    setPage(1)
  }
  useEffect(() => () => { stopSyncPolling() }, [])

  const triggerSync = async () => {
    const syncId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setSyncing(true)
    startSyncProgress('DB 동기화 진행 상태')
    beginSyncPolling(syncId)
    toast.show('동기화를 시작합니다…')
    try {
      const res = await apiFetch('/api/ui/trigger-update', {
        method: 'POST',
        body: JSON.stringify({ runScripts: true, pipeline: 'dbview-default', syncId }),
        cacheMs: 0,
        timeoutMs: 600_000,
        retries: 0,
      })
      if (!res?.ok || res?.error) {
        const detail = res?.body?.stocks?.error || res?.body?.sectors?.error || res?.body?.error || res?.error || '동기화 실패'
        finishSyncProgress('동기화 실패', String(detail), false)
        toast.show(`동기화 실패: ${detail}`)
      } else {
        if (res?.scriptRunner?.requested && !res?.scriptRunner?.enabled) {
          toast.show('스크립트 실행은 비활성 상태여서 API 패치만 수행했습니다.')
        }
        finishSyncProgress('동기화 완료', '동기화가 끝나 목록을 갱신합니다.', true)
        toast.show('동기화 완료. 목록 갱신 중…')
        await load(true)
        await loadSyncHistory()
        setSyncStage('목록 갱신 완료')
        setSyncDetail('최신 데이터 반영이 완료되었습니다.')
        setTimeout(() => setSyncModalOpen(false), 700)
      }
    } catch (e: any) {
      finishSyncProgress('동기화 오류', String(e?.message || e), false)
      toast.show(`동기화 오류: ${String(e?.message || e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const triggerFullDataSync = async () => {
    const syncId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setSyncing(true)
    startSyncProgress('전체 데이터 동기화 (섹터·종가·지표·점수)')
    beginSyncPolling(syncId)
    toast.show('전체 데이터 동기화를 시작합니다… (수 분 소요)')
    try {
      const res = await apiFetch('/api/ui/trigger-update', {
        method: 'POST',
        body: JSON.stringify({ runScripts: true, pipeline: 'data-full-sync', syncId }),
        cacheMs: 0,
        timeoutMs: 900_000,
        retries: 0,
      })
      if (!res?.ok || res?.error) {
        const detail = res?.body?.error || res?.error || '전체 동기화 실패'
        finishSyncProgress('전체 동기화 실패', String(detail), false)
        toast.show(`동기화 실패: ${detail}`)
      } else {
        if (res?.scriptRunner?.requested && !res?.scriptRunner?.enabled) {
          toast.show('스크립트 실행 비활성 상태 (ENABLE_WEB_SCRIPT_RUNNER=true 필요)')
        } else {
          finishSyncProgress('전체 동기화 완료', '섹터·종가·지표·점수가 갱신되었습니다.', true)
          toast.show('전체 동기화 완료. 목록 갱신 중…')
          await load(true)
          await loadSyncHistory()
          setSyncStage('목록 갱신 완료')
          setSyncDetail('최신 데이터가 반영되었습니다.')
          setTimeout(() => setSyncModalOpen(false), 700)
        }
      }
    } catch (e: any) {
      finishSyncProgress('전체 동기화 오류', String(e?.message || e), false)
      toast.show(`동기화 오류: ${String(e?.message || e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const forceRefreshStocksUpdatedAt = async () => {
    const syncId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setSyncing(true)
    startSyncProgress('업데이트 일자 최신화')
    beginSyncPolling(syncId)
    toast.show('업데이트 일자 강제 최신화 중…')
    try {
      const res = await apiFetch('/api/ui/trigger-update', {
        method: 'POST',
        body: JSON.stringify({ runScripts: false, syncId }),
        cacheMs: 0,
        timeoutMs: 600_000,
        retries: 0,
      })
      if (!res?.ok || res?.error) {
        const detail = res?.body?.stocks?.error || res?.body?.error || res?.error || '일자 최신화 실패'
        finishSyncProgress('일자 최신화 실패', String(detail), false)
        toast.show(`동기화 실패: ${detail}`)
      } else {
        finishSyncProgress('일자 최신화 완료', '목록 갱신을 시작합니다.', true)
        toast.show('업데이트 일자 최신화 완료')
        await load(true)
        await loadSyncHistory()
        setSyncStage('목록 갱신 완료')
        setSyncDetail('최신 업데이트 일자가 반영되었습니다.')
        setTimeout(() => setSyncModalOpen(false), 700)
      }
    } catch (e: any) {
      finishSyncProgress('일자 최신화 오류', String(e?.message || e), false)
      toast.show(`동기화 오류: ${String(e?.message || e)}`)
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => () => { stopSyncPolling() }, [])

  const openDetail = async (row: any) => {
    setDetailRow(row)
    setDetailData(null)
    setDetailMeta(null)
    setDetailLoading(true)
    try {
      const res = await apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(row.code)}`, { cacheMs: 0, timeoutMs: 10_000 })
      const data = res.data ?? []
      const normalized = Array.isArray(data)
        ? data.map((it: any) => ({
            date: formatDateKst(it.date ?? it.timestamp ?? null),
            open: asNum(it.open ?? it.o),
            close: asNum(it.close ?? it.c),
            high: asNum(it.high ?? it.h),
            low: asNum(it.low ?? it.l),
            volume: asNum(it.volume ?? it.v),
            value: asNum(it.value ?? it.amount ?? it.trading_value),
          }))
        : []
      setDetailData(normalized)
      setDetailMeta({
        latest: res.latest
          ? {
              date: formatDateKst(res.latest.date),
              open: asNum(res.latest.open),
              close: asNum(res.latest.close),
              high: asNum(res.latest.high),
              low: asNum(res.latest.low),
              volume: asNum(res.latest.volume),
              value: asNum(res.latest.value),
            }
          : normalized[0] ?? null,
        profile: res.profile ?? null,
        flow: res.flow ?? null,
      })
    } catch (e: any) {
      toast.show(`시세 조회 실패: ${String(e?.message || e)}`)
      setDetailData([])
      setDetailMeta(null)
    } finally {
      setDetailLoading(false)
    }
  }

  // 실제 stocks에 존재하는 sector_id만 추려 섹터 버튼에 표시 (0건 섹터 제거)
  const usedSectorIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of allStocks) {
      if (s.sector_id) ids.add(s.sector_id)
    }
    return ids
  }, [allStocks])

  const activeSectors = useMemo(
    () => sectors.filter((s: any) => usedSectorIds.has(s.id)),
    [sectors, usedSectorIds],
  )

  const sectorMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of sectors) m[s.id] = s.name
    return m
  }, [sectors])

  const visibleSectors = showAllSectors ? activeSectors : activeSectors.slice(0, 15)
  const totalPages = Math.ceil(total / pageSize)

  return (
    <section className="container-app dbview-page">
      {/* 헤더 */}
      <div className="portfolio-head">
        <div className="portfolio-title-wrap">
          <h1 className="title-xl portfolio-title">DB 종목 뷰</h1>
          <p className="portfolio-subtitle">등록된 종목 목록을 확인하고 데이터를 동기화합니다.</p>
        </div>
        <div className="dbview-head-actions">
          <Button
            variant="secondary"
            onClick={() => load(true)}
            disabled={loading}
          >
            새로고침
          </Button>
          <Button
            variant="primary"
            onClick={triggerSync}
            disabled={syncing || loading}
          >
            {syncing ? '동기화 중…' : '동기화'}
          </Button>
          <Button
            variant="primary"
            onClick={triggerFullDataSync}
            disabled={syncing || loading}
            title="섹터 + 종가·지표·점수 전체 재계산 (OHLCV 수집 제외, 수 분 소요)"
          >
            {syncing ? '동기화 중…' : '전체 동기화'}
          </Button>
          <Button
            variant="ghost"
            onClick={forceRefreshStocksUpdatedAt}
            disabled={syncing || loading}
          >
            일자 최신화
          </Button>
        </div>
      </div>

      {/* 통계 */}
      <div className="portfolio-stat-grid">
        <div className="card portfolio-stat-card">
          <div className="stat-label">전체 종목</div>
          <div className="stat-value">{loading ? '…' : allStocks.length.toLocaleString()}</div>
          <div className="stat-sub">DB에 등록된 종목 수</div>
        </div>
        <div className="card portfolio-stat-card">
          <div className="stat-label">검색 결과</div>
          <div className="stat-value">{loading ? '…' : total.toLocaleString()}</div>
          <div className="stat-sub">필터·검색 결과 수</div>
        </div>
        <div className="card portfolio-stat-card">
          <div className="stat-label">섹터 수</div>
          <div className="stat-value">{loading ? '…' : activeSectors.length}</div>
          <div className="stat-sub">종목이 있는 섹터</div>
        </div>
      </div>

      <div className="card mb-4" style={{ padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <div className="title-md">동기화 이력</div>
          <Button variant="ghost" onClick={() => { void loadSyncHistory() }} disabled={loading || syncing}>새로고침</Button>
        </div>
        {syncHistory.length === 0 ? (
          <div className="muted">최근 동기화 이력이 없습니다.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {syncHistory.map((it) => {
              const statusText = it.status === 'running' ? '진행 중' : it.status === 'success' ? '성공' : '실패'
              const when = formatDateKst(it.finishedAt || it.updatedAt || it.startedAt)
              return (
                <div
                  key={it.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr 70px',
                    gap: 'var(--space-2)',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border-default)',
                    background: 'var(--color-bg-elevated)',
                  }}
                >
                  <div className="caption muted">{when}</div>
                  <div>
                    <div className="caption">{it.stage}</div>
                    <div className="caption muted">{it.kind} · {it.progress}%</div>
                  </div>
                  <div className="caption" style={{ textAlign: 'right' }}>{statusText}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 필터 */}
      <div className="card mb-4 portfolio-filter-card">
        <div className="portfolio-filter-stack">
          <div>
            <div className="caption portfolio-filter-label">섹터</div>
            <div className="tag-list">
              <button
                className={`tag${!selectedSector ? ' active' : ''}`}
                onClick={() => { setSelectedSector(null); setPage(1) }}
              >전체</button>
              {visibleSectors.map((s: any) => (
                <button
                  key={s.id}
                  className={`tag${selectedSector === s.id ? ' active' : ''}`}
                  onClick={() => { setSelectedSector(s.id); setPage(1) }}
                >{s.name}</button>
              ))}
              {activeSectors.length > 15 && (
                <button className="tag" onClick={() => setShowAllSectors(v => !v)}>
                  {showAllSectors ? '접기' : `+ ${activeSectors.length - 15}개 더보기`}
                </button>
              )}
            </div>
          </div>

          <div className="portfolio-search-row">
            <input
              className="input portfolio-search-input"
              placeholder="코드 또는 종목명 검색"
              value={searchInput}
              onChange={e => onSearchChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyFilters()}
            />
            <Button className="portfolio-search-btn" variant="secondary" onClick={applyFilters} disabled={loading}>
              적용
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="portfolio-error-wrap">
          <ErrorState message={error} onRetry={() => load(true)} />
        </div>
      )}

      {/* 테이블 */}
      <div className="card dbview-table-card">
        <div className="dbview-table-head">
          <div>코드</div>
          <div>종목명</div>
          <div>섹터</div>
          <div>업데이트</div>
          <div></div>
        </div>

        {loading && (
          <div className="dbview-table-skeleton">
            <Skeleton lines={8} height={16} />
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="dbview-empty">
            <EmptyState icon={<ClipboardList size={36} strokeWidth={1.5} />} title="종목 없음" description="검색 조건에 맞는 종목이 없습니다." />
          </div>
        )}

        {!loading && rows.map((r: any) => (
          <div key={r.code} className="dbview-table-row">
            <div className="dbview-code">{r.code}</div>
            <div className="dbview-name">{r.name}</div>
            <div className="caption muted dbview-sector">{r.sector_id ? (sectorMap[r.sector_id] ?? r.sector_id) : '—'}</div>
            <div className="caption muted dbview-updated">
              {r.updated_at ? new Date(r.updated_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
            </div>
            <div className="dbview-row-actions">
              <Button variant="ghost" onClick={() => openDetail(r)}>시세</Button>
            </div>
          </div>
        ))}
      </div>

      {(totalPages > 1 || rows.length >= pageSize) && (
        <div className="pagination-wrap">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onChange={(p) => { setPage(p) }}
          />
        </div>
      )}

      <Modal
        isOpen={syncModalOpen}
        title={syncTitle || '동기화 진행'}
        onClose={() => {
          if (!syncing) setSyncModalOpen(false)
        }}
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="title-md">{syncStage}</div>
          <div
            style={{
              width: '100%',
              height: 10,
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-bg-sunken)',
              overflow: 'hidden',
              border: '1px solid var(--color-border-default)',
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(100, syncProgress))}%`,
                height: '100%',
                background: 'linear-gradient(90deg, var(--color-blue-400), var(--color-blue-600))',
                transition: 'width 300ms ease',
              }}
            />
          </div>
          <div className="muted">{syncProgress.toFixed(0)}%</div>
          <div className="muted">{syncDetail}</div>
          {!syncing && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setSyncModalOpen(false)}>닫기</Button>
            </div>
          )}
        </div>
      </Modal>

      {/* 시세 상세 모달 */}
      <Modal
        isOpen={!!detailRow}
        title={detailRow ? `${detailRow.name ?? detailRow.code} 최근 시세` : ''}
        onClose={() => { setDetailRow(null); setDetailData(null); setDetailMeta(null) }}
        size="sm"
      >
        {detailLoading && <Skeleton lines={5} height={14} />}
        {!detailLoading && detailData?.length === 0 && (
          <div className="muted">시세 데이터 없음</div>
        )}
        {!detailLoading && detailData && detailData.length > 0 && (
          <div className="dbview-detail-list">
            {detailMeta?.latest && (
              <div className="dbview-detail-summary">
                <div className="dbview-detail-summary-head">최신 기준 {detailMeta.latest.date}</div>
                <div className="dbview-detail-summary-grid">
                  <div>종가 <strong>{formatNumber(detailMeta.latest.close)}</strong></div>
                  <div className="caption muted">시가 {formatNumber(detailMeta.latest.open)}</div>
                  <div className="caption muted">고가 {formatNumber(detailMeta.latest.high)}</div>
                  <div className="caption muted">저가 {formatNumber(detailMeta.latest.low)}</div>
                  <div className="caption muted">거래량 {formatNumber(detailMeta.latest.volume)}</div>
                  <div className="caption muted">거래대금 {formatWon(detailMeta.latest.value)}</div>
                </div>
              </div>
            )}

            {(detailMeta?.profile || detailMeta?.flow) && (
              <div className="dbview-detail-summary-grid dbview-detail-meta-grid">
                <div className="caption muted">시총 {formatWon(detailMeta?.profile?.market_cap)}</div>
                <div className="caption muted">PER {formatNumber(detailMeta?.profile?.per, 2)}</div>
                <div className="caption muted">PBR {formatNumber(detailMeta?.profile?.pbr, 2)}</div>
                <div className="caption muted">EPS {formatNumber(detailMeta?.profile?.eps)}</div>
                <div className="caption muted">BPS {formatNumber(detailMeta?.profile?.bps)}</div>
                <div className="caption muted">ROE {detailMeta?.profile?.roe == null ? '—' : `${formatNumber(detailMeta.profile.roe, 2)}%`}</div>
                <div className="caption muted">부채비율 {detailMeta?.profile?.debt_ratio == null ? '—' : `${formatNumber(detailMeta.profile.debt_ratio, 2)}%`}</div>
                <div className="caption muted">외국인지분율 {detailMeta?.profile?.foreign_ratio == null ? '—' : `${formatNumber(detailMeta.profile.foreign_ratio, 2)}%`}</div>
                <div className="caption muted">수급(외국인, 주) {detailMeta?.flow?.foreign == null ? '—' : `${formatNumber(detailMeta.flow.foreign)}주`}</div>
                <div className="caption muted">수급(기관, 주) {detailMeta?.flow?.institution == null ? '—' : `${formatNumber(detailMeta.flow.institution)}주`}</div>
                <div className="caption muted">수급대금(외국인) {formatWon(detailMeta?.flow?.foreign_amount)}</div>
                <div className="caption muted">수급대금(기관) {formatWon(detailMeta?.flow?.institution_amount)}</div>
                <div className="caption muted">재무기준일 {detailMeta?.profile?.fundamentals_as_of ? formatDateKst(detailMeta.profile.fundamentals_as_of) : '—'}</div>
                <div className="caption muted">수급기준일 {detailMeta?.flow?.date ? formatDateKst(detailMeta.flow.date) : '—'}</div>
              </div>
            )}

            {detailData.map((d: any, i: number) => (
              <div key={i} className="dbview-detail-row">
                <span className="caption muted">{d.date}</span>
                <span>종가 <strong>{formatNumber(d.close)}</strong></span>
                <span className="caption muted">시 {formatNumber(d.open)} / 고 {formatNumber(d.high)} / 저 {formatNumber(d.low)}</span>
                <span className="caption muted">거래량 {formatNumber(d.volume)}</span>
                <span className="caption muted">거래대금 {formatWon(d.value)}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </section>
  )
}
