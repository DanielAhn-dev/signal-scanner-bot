import React, { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Skeleton from '../../components/Skeleton'
import Pagination from '../../components/Pagination'
import Button from '../../components/ui/Button'

export default function Trades() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState<number>(1)
  const [pageSize] = useState<number>(30)
  const [total, setTotal] = useState<number>(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<'all' | 'BUY' | 'SELL'>('all')
  const [modeFilter, setModeFilter] = useState<'all' | 'auto' | 'manual'>('all')
  const [initialized, setInitialized] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onSearchChange = (value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(value.trim())
      setPage(1)
    }, 220)
  }

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = String(params.get('q') || '').trim()
    const action = String(params.get('action') || '').toUpperCase()
    const mode = String(params.get('mode') || '').toLowerCase()
    const nextPage = Math.max(1, Number(params.get('page') || 1))

    if (q) {
      setSearchInput(q)
      setSearch(q)
    }
    if (action === 'BUY' || action === 'SELL') setActionFilter(action)
    if (mode === 'auto' || mode === 'manual') setModeFilter(mode)
    if (Number.isFinite(nextPage) && nextPage > 1) setPage(nextPage)

    setInitialized(true)
  }, [])

  useEffect(() => {
    if (!initialized) return
    const params = new URLSearchParams(window.location.search)
    if (search) params.set('q', search)
    else params.delete('q')

    if (actionFilter !== 'all') params.set('action', actionFilter)
    else params.delete('action')

    if (modeFilter !== 'all') params.set('mode', modeFilter)
    else params.delete('mode')

    if (page > 1) params.set('page', String(page))
    else params.delete('page')

    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`
    window.history.replaceState({}, '', next)
  }, [initialized, search, actionFilter, modeFilter, page])

  useEffect(() => {
    if (!initialized) return
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          withCount: '1',
        })
        if (search) params.set('q', search)
        if (actionFilter !== 'all') params.set('action', actionFilter)
        if (modeFilter !== 'all') params.set('mode', modeFilter)

        const json = await apiFetch(`/api/ui/decisions?${params.toString()}`)
        if (mounted && json?.data) {
          setRows(json.data)
          setTotal(json.count || 0)
          setPage(json.page || page)
        }
      } catch (e) {
        console.error(e)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [initialized, page, pageSize, search, actionFilter, modeFilter])

  return (
    <section className="container-app trades-page">
      <div className="trades-head">
        <h1 className="title-xl trades-title">거래 기록 / 결정 로그</h1>
        <p className="trades-subtitle">자동/수동 매수·매도 의사결정 로그를 최신순으로 확인합니다.</p>
      </div>

      <div className="card trades-filter-card">
        <div className="trades-filter-row">
          <input
            className="input trades-search-input"
            placeholder="코드/이유/전략 검색"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <Button
            variant="secondary"
            onClick={() => {
              setSearch(searchInput.trim())
              setPage(1)
            }}
            disabled={loading}
          >
            검색
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSearchInput('')
              setSearch('')
              setActionFilter('all')
              setModeFilter('all')
              setPage(1)
            }}
            disabled={loading && !search && actionFilter === 'all' && modeFilter === 'all'}
          >
            초기화
          </Button>
        </div>

        <div className="trades-filter-tags" role="tablist" aria-label="거래 액션 필터">
          <button
            type="button"
            className={`tag${actionFilter === 'all' ? ' active' : ''}`}
            onClick={() => { setActionFilter('all'); setPage(1) }}
          >
            전체
          </button>
          <button
            type="button"
            className={`tag${actionFilter === 'BUY' ? ' active' : ''}`}
            onClick={() => { setActionFilter('BUY'); setPage(1) }}
          >
            BUY
          </button>
          <button
            type="button"
            className={`tag${actionFilter === 'SELL' ? ' active' : ''}`}
            onClick={() => { setActionFilter('SELL'); setPage(1) }}
          >
            SELL
          </button>
        </div>

        <div className="trades-filter-tags" role="tablist" aria-label="자동/수동 필터">
          <button
            type="button"
            className={`tag${modeFilter === 'all' ? ' active' : ''}`}
            onClick={() => { setModeFilter('all'); setPage(1) }}
          >
            전체 모드
          </button>
          <button
            type="button"
            className={`tag${modeFilter === 'auto' ? ' active' : ''}`}
            onClick={() => { setModeFilter('auto'); setPage(1) }}
          >
            자동
          </button>
          <button
            type="button"
            className={`tag${modeFilter === 'manual' ? ' active' : ''}`}
            onClick={() => { setModeFilter('manual'); setPage(1) }}
          >
            수동
          </button>
          <span className="caption muted trades-filter-count">{total.toLocaleString('ko-KR')}건</span>
        </div>
      </div>

      <div className="cards-list trades-log-list">
        {loading && <Skeleton lines={3} height={18} />}
        {!loading && rows.length === 0 && <div className="card trades-empty-card">기록 없음</div>}
        {!loading && rows.map((r: any) => {
          const action = String(r.action || '').toUpperCase()
          const pnlAmount = Number(r.reason_details?.pnl)
          const hasPnl = action === 'SELL' && Number.isFinite(pnlAmount)
          const pnlPct = r.pnl_pct as string | null | undefined
          const detailLines = Array.isArray(r.detail_lines) ? (r.detail_lines as string[]) : []
          return (
            <div key={r.id} className="card trades-log-card">
              <div className="trades-log-top">
                <div className="trades-log-title-wrap">
                  <div className="trades-log-title">
                    {r.stock_name || r.ticker || r.symbol || r.code} ({r.code || '-'})
                    <span className={`trades-log-action ${action === 'BUY' ? 'is-buy' : 'is-sell'}`}>
                      {action || '-'}
                    </span>
                  </div>
                </div>
                <div className="trades-log-time">{new Date(r.created_at).toLocaleString('ko-KR')}</div>
              </div>
              <div className="trades-log-reason">이유: {r.reason_summary ?? r.reason ?? r.notes ?? '-'}</div>
              {hasPnl && (
                <div className={`trades-log-pnl ${pnlAmount >= 0 ? 'is-profit' : 'is-loss'}`}>
                  손익: {pnlAmount >= 0 ? '+' : ''}{Math.round(pnlAmount).toLocaleString('ko-KR')}원
                  {pnlPct ? ` (${pnlAmount >= 0 ? '+' : ''}${pnlPct})` : ''}
                </div>
              )}
              {detailLines.length > 0 && (
                <div className="trades-log-details">
                  {detailLines
                    .filter((line) => !line.startsWith('realized_pnl:'))
                    .map((line, idx) => (
                      <span key={idx} className="trades-log-detail-chip">{line}</span>
                    ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="pagination-wrap trades-pagination-wrap">
        <Pagination page={page} pageSize={pageSize} total={total} onChange={(p) => setPage(p)} />
      </div>
    </section>
  )
}
