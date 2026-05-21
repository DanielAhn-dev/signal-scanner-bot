/**
 * NewsSidePanel — 우측 고정 패널: 뉴스피드
 */
import { useEffect, useMemo, useState } from 'react'
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
  const [news, setNews]           = useState<NewsItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected]   = useState<number | null>(null)
  const [fetchedAt, setFetchedAt] = useState('')
  const [page, setPage] = useState(1)

  const totalPages = Math.max(1, Math.ceil(news.length / PAGE_SIZE))
  const pageNews = useMemo(() => {
    const from = (page - 1) * PAGE_SIZE
    return news.slice(from, from + PAGE_SIZE)
  }, [news, page])

  const load = async (force = false) => {
    try {
      setRefreshing(true)
      const res = await apiFetch('/api/ui/news', { cacheMs: force ? 0 : 20_000, timeoutMs: 12_000 })
      const items: NewsItem[] = res?.data ?? []
      setNews(items)
      setPage(1)
      setFetchedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    } catch {
      // 실패 시 기존 데이터 유지
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const id = setInterval(() => load(), 60_000)
    return () => clearInterval(id)
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
            onClick={() => load(true)}
            disabled={refreshing}
            title="새로고침"
          >
            <RefreshCw size={9} style={{ animation: refreshing ? 'xls-spin 0.8s linear infinite' : undefined }}/>
          </button>
        </div>
      </div>

      {/* 뉴스 목록 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
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
              {pageNews.map((item, idx) => {
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
            </tbody>
          </table>
        )}
      </div>

      {!loading && news.length > 0 && (
        <div className="xls-panel-header-bar" style={{ borderTop: '1px solid var(--color-excel-grid-border)', borderBottom: 'none', minHeight: 22 }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
            페이지 {page}/{totalPages} · 총 {news.length}건
          </span>
          <div className="xls-panel-header-bar__tools" style={{ gap: 4 }}>
            <button
              className="xls-toolbar-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              title="이전 페이지"
            >
              이전
            </button>
            <button
              className="xls-toolbar-btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
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
