/**
 * NewsSidePanel — 우측 고정 패널: 뉴스피드
 */
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { RefreshCw } from 'lucide-react'

type NewsItem = {
  title: string
  link?: string
  source?: string
  date?: string
  market?: string
}

function fmtTime(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr.slice(11, 16) || ''
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export default function NewsSidePanel() {
  const PAGE_SIZE = 16
  const BASE_MIN_RENDER_ROWS = 28
  const [news, setNews]           = useState<NewsItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected]   = useState<number | null>(null)
  const [fetchedAt, setFetchedAt] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [minRenderRows, setMinRenderRows] = useState(BASE_MIN_RENDER_ROWS)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const totalPages = hasMore ? page + 1 : page

  const load = async (nextPage: number, force = false) => {
    try {
      setRefreshing(true)
      const res = await apiFetch(`/api/ui/news?page=${nextPage}&pageSize=${PAGE_SIZE}`, {
        cacheMs: force ? 0 : 20_000,
        timeoutMs: 12_000,
      })
      const items: NewsItem[] = res?.data ?? []
      setNews(items)
      setPage(nextPage)
      setHasMore(Boolean(res?.hasMore))
      setFetchedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    } catch {
      // 실패 시 기존 데이터 유지
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { void load(1) }, [])
  useEffect(() => {
    const id = setInterval(() => { void load(page) }, 60_000)
    return () => clearInterval(id)
  }, [page])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const updateRows = () => {
      const viewportHeight = el.clientHeight
      const headerRowsHeight = 40
      const approxRowHeight = 22
      const visibleRows = Math.ceil(Math.max(0, viewportHeight - headerRowsHeight) / approxRowHeight)
      const next = Math.max(BASE_MIN_RENDER_ROWS, visibleRows + 2)
      setMinRenderRows((prev) => (prev === next ? prev : next))
    }

    updateRows()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateRows)
      observer.observe(el)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateRows)
    return () => window.removeEventListener('resize', updateRows)
  }, [])

  return (
    <div className="news-side-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 패널 헤더 */}
      <div className="xls-panel-header-bar">
        <span>
          뉴스 피드
          {fetchedAt && (
            <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
              {' '}· {fetchedAt}
            </span>
          )}
        </span>
        <div className="xls-panel-header-bar__tools">
          <button
            className="xls-toolbar-btn"
            onClick={() => { void load(page, true) }}
            disabled={refreshing}
            title="새로고침"
          >
            <RefreshCw size={9} style={{ animation: refreshing ? 'xls-spin 0.8s linear infinite' : undefined }}/>
          </button>
        </div>
      </div>

      {/* 뉴스 목록 */}
      <div ref={viewportRef} style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 12, textAlign: 'center', fontSize: 10, color: 'var(--color-text-tertiary)' }}>
            불러오는 중...
          </div>
        ) : (
          <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 28 }}/>
              <col style={{ width: 84 }}/>
              <col style={{ width: 62 }}/>
              <col/>
            </colgroup>
            <thead>
              <tr className="xls-letter-row">
                <th className="xls-corner"/>
                <th className="xls-col-letter">A</th>
                <th className="xls-col-letter">B</th>
                <th className="xls-col-letter">C</th>
              </tr>
              <tr className="xls-header-row">
                <th className="xls-row-num-header"/>
                <th className="xls-th">출처</th>
                <th className="xls-th">시각</th>
                <th className="xls-th">헤드라인</th>
              </tr>
            </thead>
            <tbody>
              {news.map((item, idx) => {
                const i = (page - 1) * PAGE_SIZE + idx
                return (
                <tr
                  key={i}
                  className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}${selected === i ? ' xls-row--selected' : ''}`}
                  onClick={() => setSelected(i === selected ? null : i)}
                  style={{ cursor: item.link ? 'pointer' : 'default' }}
                  onDoubleClick={() => item.link && window.open(item.link, '_blank', 'noopener')}
                >
                  <td className="xls-row-num">{i + 1}</td>
                  <td className="xls-cell" style={{ fontSize: 9 }}>
                    {(item.source || item.market) && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '1px 3px', borderRadius: 1, fontSize: 9, fontWeight: 600,
                        background: 'var(--color-brand-subtle)', color: 'var(--color-brand)',
                        whiteSpace: 'nowrap', maxWidth: '100%',
                      }}>
                        {item.source || item.market}
                      </span>
                    )}
                  </td>
                  <td className="xls-cell xls-cell--num" style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
                    {fmtTime(item.date)}
                  </td>
                  <td className="xls-cell" style={{ fontSize: 11, whiteSpace: 'normal', lineHeight: 1.3, paddingTop: 2, paddingBottom: 2 }}>
                    <span
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                      title={item.title}
                    >
                    {item.title}
                    </span>
                  </td>
                </tr>
              )})}
              {Array.from({ length: Math.max(0, minRenderRows - news.length) }, (_, idx) => {
                const rn = (page - 1) * PAGE_SIZE + news.length + idx + 1
                return (
                  <tr key={`e${rn}`} className={`xls-row${rn % 2 === 0 ? ' xls-row--even' : ''}`}>
                    <td className="xls-row-num">{rn}</td>
                    <td className="xls-cell xls-cell--empty" />
                    <td className="xls-cell xls-cell--empty" />
                    <td className="xls-cell xls-cell--empty" />
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {!loading && news.length > 0 && (
        <div className="xls-panel-header-bar" style={{ borderTop: '1px solid var(--color-excel-grid-border)', borderBottom: 'none', minHeight: 22 }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
            페이지 {page}/{totalPages} · 현재 {news.length}건
          </span>
          <div className="xls-panel-header-bar__tools" style={{ gap: 4 }}>
            <button
              className="xls-toolbar-btn"
              onClick={() => { if (page > 1) void load(page - 1, true) }}
              disabled={page <= 1}
              title="이전 페이지"
            >
              이전
            </button>
            <button
              className="xls-toolbar-btn"
              onClick={() => { if (hasMore) void load(page + 1, true) }}
              disabled={!hasMore}
              title="다음 페이지"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
