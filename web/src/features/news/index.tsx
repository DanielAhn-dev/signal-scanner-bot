import React, { useEffect, useRef, useState } from 'react'
import Button from '../../components/ui/Button'
import { apiFetch } from '../../lib/api'
import StockDetailModal from '../../components/StockDetailModal'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import SheetHeaderBar from '../../components/SheetHeaderBar'

type NewsItem = {
  title: string
  link: string
  source?: string
  date?: string
}

const PRESS_NAME_RE = /^[가-힣A-Za-z0-9·\s]{2,20}$/
const DATE_LIKE_RE = /^\d{4}[-.]\d{2}[-.]\d{2}(\s+\d{2}:\d{2}(:\d{2})?)?$|^\d{2}[:.]\d{2}(:\d{2})?$/

function asText(value: unknown): string {
  return String(value ?? '').trim()
}

function pickText(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asText(obj[key])
    if (value) return value
  }
  return ''
}

function looksLikePressName(value: string): boolean {
  if (!value) return false
  if (DATE_LIKE_RE.test(value)) return false
  return PRESS_NAME_RE.test(value)
}

function looksLikeDate(value: string): boolean {
  return !!value && DATE_LIKE_RE.test(value)
}

function normalizeNewsItem(raw: unknown): NewsItem | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>

  let title = pickText(row, ['title', 'headline', 'subject', 'newsTitle', 'titleFull'])
  const link = pickText(row, ['link', 'url', 'newsUrl', 'mobileNewsUrl'])
  let source = pickText(row, ['source', 'press', 'officeName', 'publisher'])
  let date = pickText(row, ['date', 'datetime', 'publishedAt', 'createdAt'])

  // 과거 응답/스크래핑 오염 케이스: title<-출처, source<-시간으로 밀리는 경우 복원
  if (looksLikePressName(title) && looksLikeDate(source) && !date) {
    date = source
    source = title
    title = pickText(row, ['headline', 'subject', 'newsTitle'])
  }

  if (!title) {
    title = pickText(row, ['headline', 'subject', 'newsTitle'])
  }
  if (!source && looksLikePressName(title)) {
    source = title
  }
  if (!date && looksLikeDate(source)) {
    date = source
    source = ''
  }

  // 제목이 완전히 비어도 행 유지(관련주 조회/링크 이동 방지 목적)
  if (!title) title = '제목 없음'

  return { title, link, source: source || undefined, date: date || undefined }
}

function normalizeNewsItems(payload: unknown): NewsItem[] {
  if (!Array.isArray(payload)) return []
  return payload
    .map(normalizeNewsItem)
    .filter((item): item is NewsItem => !!item)
}

function decodeHtml(str: string): string {
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

type RelatedStock = { code: string; name: string }
const PAGE_SIZE = 40

/** "2026-05-22 09:45:10" → "09:45" (당일) / "05-22 09:45" (다른 날) */
function formatDate(raw: string | undefined): string {
  if (!raw) return '—'
  const today = new Date().toISOString().slice(0, 10)
  if (raw.startsWith(today)) return raw.slice(11, 16)
  return raw.slice(5, 16)
}

export default function NewsPage() {
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [relatedMap, setRelatedMap] = useState<Record<string, RelatedStock[]>>({})
  const [relatedLoadingSet, setRelatedLoadingSet] = useState<Set<string>>(new Set())
  const [relatedOpenSet, setRelatedOpenSet] = useState<Set<string>>(new Set())
  const [modalStock, setModalStock] = useState<RelatedStock | null>(null)
  const [baseStock, setBaseStock] = useState<RelatedStock | null>(null)
  const [dummyRows, setDummyRows] = useState(0)
  const fetchedRelated = useRef<Set<string>>(new Set())
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const metaTableRef = useRef<HTMLTableElement | null>(null)
  const dataTableRef = useRef<HTMLTableElement | null>(null)

  const load = async (nextQuery = appliedQuery, nextPage = page) => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      })
      if (nextQuery.trim()) qs.set('q', nextQuery.trim())
      const endpoint = `/api/ui/news?${qs.toString()}`
      const res = await apiFetch(endpoint, { cacheMs: 20_000, timeoutMs: 12_000 })
      setItems(normalizeNewsItems(res?.data))
      setPage(nextPage)
      setHasMore(Boolean(res?.hasMore))
      const code = String(res?.code || '')
      const name = String(res?.name || '')
      setBaseStock(code && name ? { code, name } : null)
      setRelatedMap({})
      setRelatedOpenSet(new Set())
      setRelatedLoadingSet(new Set())
      fetchedRelated.current = new Set()
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load('', 1) }, [])

  const applyQuery = () => {
    const next = query.trim()
    setAppliedQuery(next)
    void load(next, 1)
  }

  const toggleRelated = async (item: NewsItem) => {
    const key = item.link || item.title
    if (relatedOpenSet.has(key)) {
      setRelatedOpenSet(prev => { const s = new Set(prev); s.delete(key); return s })
      return
    }
    setRelatedOpenSet(prev => new Set(prev).add(key))
    if (fetchedRelated.current.has(key)) return
    fetchedRelated.current.add(key)
    setRelatedLoadingSet(prev => new Set(prev).add(key))
    try {
      const qs = new URLSearchParams({ title: item.title })
      if (item.link) qs.set('link', item.link)
      if (baseStock?.code && baseStock?.name) {
        qs.set('baseCode', baseStock.code)
        qs.set('baseName', baseStock.name)
      }
      const res = await fetch(`/api/ui/news-related?${qs.toString()}`)
      const data: RelatedStock[] = await res.json()
      setRelatedMap(prev => ({ ...prev, [key]: Array.isArray(data) ? data : [] }))
    } catch {
      setRelatedMap(prev => ({ ...prev, [key]: [] }))
    } finally {
      setRelatedLoadingSet(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }

  const openModal = (stock: RelatedStock) => setModalStock(stock)
  const closeModal = () => setModalStock(null)

  const dataRowCount = items.length + items.reduce((acc, item) => {
    const key = item.link || item.title
    return acc + (relatedOpenSet.has(key) ? 1 : 0)
  }, 0)

  useEffect(() => {
    const sheet = sheetRef.current
    const metaTable = metaTableRef.current
    const dataTable = dataTableRef.current
    if (!sheet || !metaTable || !dataTable) return
    const viewport = sheet.closest('.xls-content-data') as HTMLElement | null
    if (!viewport) return

    const updateDummyRows = () => {
      const sheetStyle = window.getComputedStyle(sheet)
      const padV = (parseFloat(sheetStyle.paddingTop) || 0) + (parseFloat(sheetStyle.paddingBottom) || 0)
      const metaHeight = metaTable.offsetHeight
      const headHeight = dataTable.tHead?.offsetHeight ?? 24
      const firstRow = dataTable.tBodies[0]?.querySelector('tr.xls-row') as HTMLTableRowElement | null
      const rowHeight = firstRow?.offsetHeight || 22

      const baseRows = loading || error || items.length === 0 ? 1 : dataRowCount
      const availableHeight = Math.max(0, viewport.clientHeight - padV - metaHeight - headHeight)
      const maxRows = Math.floor(availableHeight / rowHeight)
      const next = Math.max(0, maxRows - baseRows)
      setDummyRows((prev) => (prev === next ? prev : next))
    }

    updateDummyRows()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateDummyRows)
      observer.observe(viewport)
      observer.observe(sheet)
      observer.observe(metaTable)
      observer.observe(dataTable)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateDummyRows)
    return () => window.removeEventListener('resize', updateDummyRows)
  }, [loading, error, items.length, dataRowCount])

  /*
   * ──────────────────────────────────────────────────────────────
   * ▶ row-num 셀을 완전히 제거한 4열 구조
   *   xls-content-data 안에서 display:none 된 row-num td가
   *   나머지 열을 한 칸씩 앞으로 당기는 버그를 근본 해결
   * ──────────────────────────────────────────────────────────────
   */
  const colGroup = (
    <colgroup>
      <col />                          {/* 제목 (가변폭 최대 확보) */}
      <col style={{ width: 104 }} />   {/* 출처 */}
      <col style={{ width: 76 }} />    {/* 일자 */}
      <col style={{ width: 112 }} />   {/* 관련주 */}
    </colgroup>
  )

  return (
    <div ref={sheetRef} className="news-sheet xls-page-inset">

      <div className="sheet-page-header-row">
        <SheetHeaderBar
          className="news-sheet__page-header"
          title="뉴스"
          subtitle="텔레그램 /news 명령과 같은 뉴스 소스를 웹에서도 조회합니다."
          action={(
            <Button className="news-sheet__header-refresh" variant="secondary" onClick={() => load(appliedQuery, page)} disabled={loading} title="새로고침" aria-label="새로고침">
              <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
              <span className="news-sheet__header-refresh-label">새로고침</span>
            </Button>
          )}
        />
      </div>

      {/* ═══ 메타 헤더 테이블 ═══ */}
      <div className="news-sheet__meta-scroll xls-scroll-frame" style={{ ['--xls-table-min-width' as any]: '860px' }}>
        <table ref={metaTableRef} className="xls-table news-sheet__table" style={{ width: 'max-content', minWidth: '100%', tableLayout: 'auto' }}>
          {colGroup}
          <tbody>
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" colSpan={3} style={{ padding: '2px 6px' }}>
                <input
                  className="news-sheet__search-input"
                  placeholder="종목명 또는 코드 (비우면 시장 뉴스)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyQuery() } }}
                />
              </td>
              <td className="xls-cell" style={{ padding: '2px 4px', textAlign: 'right' }}>
                <Button variant="primary" onClick={applyQuery} disabled={loading}>조회</Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ═══ 데이터 테이블 (sticky 헤더) ═══ */}
      <div className="news-sheet__table-scroll xls-scroll-frame" style={{ ['--xls-table-min-width' as any]: '860px' }}>
        <table ref={dataTableRef} className="xls-table" style={{ width: 'max-content', minWidth: '100%', tableLayout: 'auto' }}>
          {colGroup}
          <thead>
            <tr className="xls-header-row">
              <th className="xls-th">제목</th>
              <th className="xls-th">출처</th>
              <th className="xls-th">일자</th>
              <th className="xls-th">관련주</th>
            </tr>
          </thead>
          <tbody>

          {loading && (
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" colSpan={4} style={{ color: 'var(--color-text-tertiary)' }}>
                불러오는 중...
              </td>
            </tr>
          )}

          {!loading && error && (
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" colSpan={3} style={{ color: 'var(--color-error)' }}>
                {error}
              </td>
              <td className="xls-cell" style={{ textAlign: 'right' }}>
                <Button variant="secondary" onClick={() => load(appliedQuery, page)}>재시도</Button>
              </td>
            </tr>
          )}

          {!loading && !error && items.length === 0 && (
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" colSpan={4} style={{ color: 'var(--color-text-tertiary)' }}>
                조건에 맞는 뉴스를 찾지 못했습니다.
              </td>
            </tr>
          )}

          {!loading && !error && items.map((item, idx) => {
            const key = item.link || item.title
            const rowNumber = (page - 1) * PAGE_SIZE + idx + 1
            const isEven = rowNumber % 2 === 0
            return (
              <React.Fragment key={`${page}-${item.link}-${idx}`}>
                <tr className={`xls-row${isEven ? ' xls-row--even' : ''}`}>
                  <td className="xls-cell news-cell--title">
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      title={decodeHtml(item.title)}
                    >
                      {decodeHtml(item.title)}
                    </a>
                  </td>
                  <td className="xls-cell" style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {item.source || '—'}
                  </td>
                  <td className="xls-cell" style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatDate(item.date)}
                  </td>
                  <td className="xls-cell" style={{ padding: '0 2px' }}>
                    <Button
                      size="sm"
                      className="news-related-toggle"
                      variant="ghost"
                      onClick={() => toggleRelated(item)}
                      style={{ whiteSpace: 'nowrap', width: '100%', justifyContent: 'center' }}
                    >
                      {relatedOpenSet.has(key) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          접기 <ChevronUp size={12} />
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          관련주 <ChevronDown size={12} />
                        </span>
                      )}
                    </Button>
                  </td>
                </tr>

                {relatedOpenSet.has(key) && (() => {
                  const stocks = relatedMap[key]
                  const isLoading = relatedLoadingSet.has(key)
                  return (
                    <tr className={`xls-row${isEven ? '' : ' xls-row--even'}`}>
                      <td className="xls-cell" colSpan={4} style={{ padding: '4px 8px' }}>
                        {isLoading && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>조회 중...</span>}
                        {!isLoading && stocks && stocks.length === 0 && (
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>제목에서 종목을 찾지 못했습니다.</span>
                        )}
                        {!isLoading && stocks && stocks.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {stocks.map(s => (
                              <Button key={s.code} variant="ghost" size="sm" onClick={() => openModal(s)}>
                                {s.name} 시세
                              </Button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })()}
              </React.Fragment>
            )
          })}

          {Array.from({ length: dummyRows }, (_, i) => {
            const baseRows = loading || error || items.length === 0 ? 1 : dataRowCount
            const rn = baseRows + i + 1
            return (
              <tr key={`dummy-${rn}`} className={`xls-row${rn % 2 === 0 ? ' xls-row--even' : ''}`}>
                <td className="xls-cell xls-cell--empty" />
                <td className="xls-cell xls-cell--empty" />
                <td className="xls-cell xls-cell--empty" />
                <td className="xls-cell xls-cell--empty" />
              </tr>
            )
          })}

          </tbody>
        </table>
      </div>

      {!loading && !error && (
        <div className="xls-panel-header-bar" style={{ borderTop: '1px solid var(--color-excel-grid-border)', borderBottom: 'none', minHeight: 22 }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
            페이지 {page} · 현재 {items.length}건
          </span>
          <div className="xls-panel-header-bar__tools" style={{ gap: 4 }}>
            <button
              className="xls-toolbar-btn"
              onClick={() => { if (page > 1) void load(appliedQuery, page - 1) }}
              disabled={page <= 1 || loading}
              title="이전 페이지"
            >
              이전
            </button>
            <button
              className="xls-toolbar-btn"
              onClick={() => { if (hasMore) void load(appliedQuery, page + 1) }}
              disabled={!hasMore || loading}
              title="다음 페이지"
            >
              다음
            </button>
          </div>
        </div>
      )}

      <StockDetailModal
        code={modalStock?.code ?? ''}
        name={modalStock?.name ?? ''}
        isOpen={!!modalStock}
        onClose={closeModal}
      />
    </div>
  )
}
