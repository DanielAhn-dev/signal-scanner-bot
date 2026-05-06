import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { searchStocks } from '../../lib/stockCache'
import { formatKrw } from '../../lib/format'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState, EmptyState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
import StockDetailModal from '../../components/StockDetailModal'

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
  const [activeAddIndex, setActiveAddIndex] = useState(-1)
  const [mutatingCode, setMutatingCode] = useState<string | null>(null)
  const [highlightCode, setHighlightCode] = useState<string | null>(null)
  const [detailCode, setDetailCode] = useState<string>('')
  const [detailName, setDetailName] = useState<string>('')
  const [detailOpen, setDetailOpen] = useState(false)
  const didInitRef = useRef(false)
  const addDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toast = useToast()

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
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [items.length])

  useEffect(() => {
    // Prevent duplicate initial fetch in React StrictMode dev cycle.
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
        // 클라이언트 캐시에서 즉시 필터링 (API 호출 없음)
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

  const watchedCodes = useMemo(() => new Set(items.map((it: any) => String(it.code))), [items])
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
    setMutatingCode(code)
    try {
      const res = await apiFetch('/api/ui/watchlist', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify({ code }),
      })
      if (res?.error) throw new Error(String(res.error))
      toast.show('관심 종목에 추가되었습니다 ✓')
      await load(true)
      flashAdded(code)
    } catch (e: any) {
      toast.show(String(e?.message || e))
    } finally {
      setMutatingCode(null)
    }
  }

  const removeInterest = async (code: string) => {
    if (!code) return
    setMutatingCode(code)
    try {
      const res = await apiFetch('/api/ui/watchlist', {
        method: 'DELETE',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify({ code }),
      })
      if (res?.error) throw new Error(String(res.error))
      const next = items.filter((it: any) => String(it.code) !== String(code))
      setItems(next)
      writeWatchlistSnapshot(next)
      toast.show('관심 종목에서 제거되었습니다')
    } catch (e: any) {
      toast.show(String(e?.message || e))
    } finally {
      setMutatingCode(null)
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
  }

  return (
    <section className="container-app watchlist-page">
      <div className="watchlist-head">
        <div>
          <h1 className="title-xl watchlist-title">관심 종목</h1>
          <p className="watchlist-subtitle">빠르게 찾고, 바로 추가/삭제할 수 있게 정리된 관심 관리 화면입니다.</p>
        </div>
        <div className="watchlist-head-actions">
          <span className="watchlist-count-pill">전체 {watchCount}개 · 표시 {visibleCount}개</span>
          <Button variant="secondary" onClick={() => load(true)} disabled={loading}>새로고침</Button>
        </div>
      </div>

      <div className="card mb-4 watchlist-manage-card watchlist-manage-sticky">
        <div className="watchlist-manage-caption">텔레그램 <code>/watchlist</code>와 동일한 관심 목록입니다.</div>

        <div className="watchlist-manage-grid">
          <div className="watchlist-field">
            <label className="watchlist-label">내 관심 검색</label>
            <input
              className="input watchlist-input"
              placeholder="코드 또는 종목명"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
            />
          </div>

          <div className="watchlist-field">
            <label className="watchlist-label">전체 종목에서 추가</label>
            <input
              className="input watchlist-input"
              placeholder="코드/종목명 2글자 이상"
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              onKeyDown={onAddSearchKeyDown}
            />

            {addLoading && <div className="caption watchlist-add-hint">검색 중...</div>}
            {!addLoading && addSearch.trim().length >= 2 && addResults.length === 0 && (
              <div className="caption watchlist-add-hint">검색 결과가 없습니다.</div>
            )}

            {!addLoading && addSearch.trim().length >= 2 && addResults.length > 0 && (
              <div className="watchlist-add-results">
                {visibleAddResults.map((s: any, idx: number) => {
                  const code = String(s.code || '')
                  const exists = watchedCodes.has(code)
                  return (
                    <div key={code} className={`watchlist-add-row${idx === activeAddIndex ? ' active' : ''}`}>
                      <div>
                        <div className="watchlist-add-name">{s.name ?? code}</div>
                        <div className="caption">{code}</div>
                      </div>
                      <Button
                        className="watchlist-icon-btn"
                        variant={exists ? 'ghost' : 'secondary'}
                        onClick={() => addInterest(code)}
                        disabled={exists || mutatingCode === code}
                        title={exists ? '이미 관심 종목' : '관심 종목에 추가'}
                      >
                        <span className="watchlist-btn-symbol" aria-hidden>{exists ? 'OK' : '+'}</span>
                        <span className="watchlist-btn-label">{exists ? '추가됨' : (mutatingCode === code ? '추가중' : '추가')}</span>
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => load(true)} />}
      {loading && <div className="card"><Skeleton lines={4} height={16} /></div>}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="관심 종목 없음"
          description="텔레그램 /watchadd 명령으로 관심 종목을 추가하세요."
        />
      )}

      <div className="watchlist-list-shell">
        <div className="cards-list watchlist-cards-list">
          {!loading && filteredItems.map((r: any, idx: number) => (
            <div
              key={r.id}
              className={`card watchlist-item-card${highlightCode === String(r.code) ? ' watchlist-item-highlight' : ''}`}
              data-hoverable
              role="button"
              tabIndex={0}
              onClick={() => openDetail(r)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openDetail(r)
              }}
              style={{ '--watchlist-i': idx } as React.CSSProperties}
            >
              <div className="flex-between watchlist-item-top">
                <div>
                  <div className="title-md watchlist-item-title">{r.stock_name ?? r.code}</div>
                  <div className="caption">{r.code}</div>
                </div>
                <div className="text-right watchlist-item-actions">
                  {r.recommended_buy_qty ? (
                    <div className="caption watchlist-item-meta">추천 {r.recommended_buy_qty}주 · {formatKrw(r.recommended_buy_amount)}</div>
                  ) : (
                    <div className="caption watchlist-item-meta">관심</div>
                  )}
                  <Button
                    className="watchlist-icon-btn watchlist-delete-btn"
                    variant="ghost"
                    onClick={(e: any) => {
                      e?.stopPropagation?.()
                      removeInterest(String(r.code))
                    }}
                    disabled={mutatingCode === String(r.code)}
                    title="관심 종목에서 삭제"
                  >
                    <span className="watchlist-btn-symbol" aria-hidden>x</span>
                    <span className="watchlist-btn-label">{mutatingCode === String(r.code) ? '삭제중' : '삭제'}</span>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
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
