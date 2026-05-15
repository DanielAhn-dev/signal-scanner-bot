import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { searchStocks } from '../../lib/stockCache'
import { formatKrw } from '../../lib/format'
import Skeleton from '../../components/Skeleton'
import { ErrorState, EmptyState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
import StockDetailModal from '../../components/StockDetailModal'
import useWatchlistActions from '../../hooks/useWatchlistActions'

const WATCHLIST_SNAPSHOT_KEY = 'watchlist_snapshot_v1'

function readWatchlistSnapshot() {
  try {
    const raw = sessionStorage.getItem(WATCHLIST_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.items)) return null
    return {
      items: parsed.items as any[],
      ts: Number(parsed.ts || 0),
    }
  } catch {
    return null
  }
}

function writeWatchlistSnapshot(items: any[]) {
  try {
    sessionStorage.setItem(WATCHLIST_SNAPSHOT_KEY, JSON.stringify({ items, ts: Date.now() }))
  } catch {
    // ignore storage quota errors
  }
}

export default function WatchlistPage() {
  const snapshot = readWatchlistSnapshot()
  const [items, setItems] = useState<any[]>(() => snapshot?.items ?? [])
  const [loading, setLoading] = useState(() => !snapshot)
  const [error, setError] = useState<string | null>(null)
  const [listSearch, setListSearch] = useState('')
  const [addSearch, setAddSearch] = useState('')
  const [addResults, setAddResults] = useState<any[]>([])
  const [addLoading, setAddLoading] = useState(false)
  const [addFocused, setAddFocused] = useState(false)
  const [activeAddIndex, setActiveAddIndex] = useState(-1)
  const [highlightCode, setHighlightCode] = useState<string | null>(null)
  const [detailCode, setDetailCode] = useState<string>('')
  const [detailName, setDetailName] = useState<string>('')
  const [detailOpen, setDetailOpen] = useState(false)
  const didInitRef = useRef(false)
  const addDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toast = useToast()
  const {
    replaceWatchedCodes,
    isWatched,
    isAdding,
    isRemoving,
    addToWatchlist,
    removeFromWatchlist,
  } = useWatchlistActions()

  const load = useCallback(async (force = false) => {
    if (!force && items.length > 0) return
    setLoading(true)
    if (force) setError(null)
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '60',
        positionType: 'interest',
        includeLots: '0',
      })
      if (force) params.set('cacheMs', '0')
      const res = await apiFetch(`/api/ui/positions?${params.toString()}`, {
        cacheMs: force ? 0 : 60_000,
        timeoutMs: 12_000,
        retries: 1,
      })
      const nextItems = res?.data ?? []
      setItems(nextItems)
      writeWatchlistSnapshot(nextItems)
      replaceWatchedCodes(nextItems.map((it: any) => String(it?.code || '')))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [items.length, replaceWatchedCodes])

  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    if (!snapshot) void load(false)
  }, [load, snapshot])

  useEffect(() => {
    if (addDebounceRef.current) clearTimeout(addDebounceRef.current)
    const q = addSearch.trim()
    if (q.length < 2) {
      setAddResults([])
      setActiveAddIndex(-1)
      return
    }

    addDebounceRef.current = setTimeout(async () => {
      setAddLoading(true)
      try {
        const results = await searchStocks(q, 20)
        setAddResults(results)
        setActiveAddIndex(-1)
      } catch {
        setAddResults([])
        setActiveAddIndex(-1)
      } finally {
        setAddLoading(false)
      }
    }, 80)
  }, [addSearch])

  useEffect(() => () => {
    if (addDebounceRef.current) clearTimeout(addDebounceRef.current)
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
  }, [])

  const flashAdded = (code: string) => {
    if (!code) return
    setHighlightCode(code)
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightCode(null), 1300)
  }

  const visibleAddResults = useMemo(() => addResults.slice(0, 6), [addResults])
  const filteredItems = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    if (!q) return items
    return items.filter((r: any) =>
      String(r.code || '').toLowerCase().includes(q) ||
      String(r.stock_name || '').toLowerCase().includes(q)
    )
  }, [items, listSearch])
  const watchCount = items.length
  const visibleCount = filteredItems.length

  const addInterest = async (code: string) => {
    if (!code) return
    try {
      const result = await addToWatchlist(code)
      if (result === 'added') {
        toast.show('관심 종목에 추가되었습니다 ✓')
        setAddSearch('')
        setAddResults([])
        await load(true)
        flashAdded(code)
      } else if (result === 'exists') {
        toast.show('이미 관심 종목에 있습니다')
      }
    } catch (e: any) {
      toast.show(String(e?.message || e))
    }
  }

  const removeInterest = async (code: string) => {
    if (!code) return
    try {
      const result = await removeFromWatchlist(code)
      if (result !== 'removed' && result !== 'not-found') return
      const next = items.filter((it: any) => String(it.code) !== String(code))
      setItems(next)
      writeWatchlistSnapshot(next)
      replaceWatchedCodes(next.map((it: any) => String(it?.code || '')))
      toast.show('관심 종목에서 제거되었습니다')
    } catch (e: any) {
      toast.show(String(e?.message || e))
    }
  }

  const openDetail = (row: any) => {
    setDetailCode(String(row?.code || ''))
    setDetailName(String(row?.stock_name || row?.code || ''))
    setDetailOpen(true)
  }

  const onAddSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!visibleAddResults.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveAddIndex((prev) => (prev < visibleAddResults.length - 1 ? prev + 1 : 0))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveAddIndex((prev) => (prev > 0 ? prev - 1 : visibleAddResults.length - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const idx = activeAddIndex >= 0 ? activeAddIndex : 0
      const picked = visibleAddResults[idx]
      const code = String(picked?.code || '')
      if (code) void addInterest(code)
    }
    if (e.key === 'Escape') {
      setAddSearch('')
      setAddResults([])
    }
  }

  const showAddResults = addFocused && addSearch.trim().length >= 2

  return (
    <section className="wl-page">
      {/* 헤더 */}
      <div className="wl-header">
        <div className="wl-header-left">
          <h1 className="wl-title">관심 종목</h1>
          {watchCount > 0 && (
            <span className="wl-count-chip">{watchCount}개</span>
          )}
        </div>
        <button
          className="wl-refresh-btn"
          onClick={() => load(true)}
          disabled={loading}
          title="새로고침"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.05-3.37L10 6h5V1l-1.35 1.35z" fill="currentColor"/>
          </svg>
          새로고침
        </button>
      </div>

      <p className="wl-desc">텔레그램 /watchlist와 동일한 관심 목록입니다.</p>

      {/* 검색 & 추가 패널 */}
      <div className="wl-control">
        {/* 내 관심 필터 검색 */}
        <div className="wl-search-row">
          <svg className="wl-search-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            className="wl-search-input"
            placeholder={`내 관심에서 검색 (${watchCount}개)`}
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
          />
          {listSearch && (
            <button className="wl-search-clear" onClick={() => setListSearch('')} aria-label="검색 초기화">
              ×
            </button>
          )}
        </div>

        {/* 추가 구분선 */}
        <div className="wl-control-divider" />

        {/* 종목 추가 검색 */}
        <div className="wl-add-wrap">
          <div className="wl-add-row">
            <svg className="wl-search-icon wl-add-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              className="wl-search-input"
              placeholder="종목 추가 (코드/종목명 2글자 이상)"
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              onKeyDown={onAddSearchKeyDown}
              onFocus={() => setAddFocused(true)}
              onBlur={() => setTimeout(() => setAddFocused(false), 150)}
            />
            {addLoading && <span className="wl-add-spinner" />}
            {addSearch && !addLoading && (
              <button className="wl-search-clear" onClick={() => { setAddSearch(''); setAddResults([]) }} aria-label="초기화">
                ×
              </button>
            )}
          </div>

          {/* 검색 결과 드롭다운 */}
          {showAddResults && (
            <div className="wl-add-dropdown">
              {addResults.length === 0 && !addLoading && (
                <div className="wl-add-empty">검색 결과가 없습니다.</div>
              )}
              {visibleAddResults.map((s: any, idx: number) => {
                const code = String(s.code || '')
                const exists = isWatched(code)
                const isAddingNow = isAdding(code)
                return (
                  <button
                    key={code}
                    type="button"
                    className={`wl-add-item${idx === activeAddIndex ? ' wl-add-item--active' : ''}${exists ? ' wl-add-item--exists' : ''}`}
                    onClick={() => !exists && !isAddingNow && void addInterest(code)}
                    disabled={exists || isAddingNow}
                  >
                    <div className="wl-add-item-info">
                      <span className="wl-add-item-name">{s.name ?? code}</span>
                      <span className="wl-add-item-code">{code}</span>
                    </div>
                    <span className={`wl-add-item-action${exists ? ' wl-add-item-action--exists' : ''}`}>
                      {exists ? '추가됨' : isAddingNow ? '추가중...' : '+ 추가'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => load(true)} />}

      {/* 목록 */}
      <div className="wl-list-section">
        {loading && (
          <div className="wl-list-card">
            <Skeleton lines={4} height={18} />
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <EmptyState
            title="관심 종목 없음"
            description="위 검색창으로 종목을 추가하거나 텔레그램 /watchadd 명령을 사용하세요."
          />
        )}

        {!loading && filteredItems.length === 0 && listSearch && items.length > 0 && (
          <div className="wl-list-card wl-no-results">
            <span>'{listSearch}' 검색 결과가 없습니다.</span>
          </div>
        )}

        {!loading && filteredItems.length > 0 && (
          <>
            {listSearch && (
              <div className="wl-list-meta">{visibleCount}개 표시</div>
            )}
            <div className="wl-list-card">
              {filteredItems.map((r: any, idx: number) => {
                const code = String(r.code)
                const removing = isRemoving(code)
                const hasRec = !!r.recommended_buy_qty
                return (
                  <button
                    type="button"
                    key={r.id ?? code}
                    className={`wl-row${highlightCode === code ? ' wl-row--highlight' : ''}${removing ? ' wl-row--removing' : ''}`}
                    style={{ '--wl-i': idx } as React.CSSProperties}
                    onClick={() => openDetail(r)}
                    title={`${r.stock_name ?? code} 상세`}
                  >
                    <div className="wl-row-left">
                      <span className="wl-row-name">{r.stock_name ?? code}</span>
                      <span className="wl-row-code">{code}</span>
                    </div>
                    <div className="wl-row-right">
                      {hasRec ? (
                        <span className="wl-row-rec">
                          {r.recommended_buy_qty}주 · {formatKrw(r.recommended_buy_amount)}
                        </span>
                      ) : (
                        <span className="wl-row-tag">관심</span>
                      )}
                      <button
                        type="button"
                        className="wl-delete-btn"
                        onClick={(e) => { e.stopPropagation(); void removeInterest(code) }}
                        disabled={removing}
                        title="관심 종목에서 제거"
                        aria-label="제거"
                      >
                        {removing ? (
                          <span className="wl-add-spinner" />
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      <StockDetailModal
        code={detailCode}
        name={detailName}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </section>
  )
}
