import React, { useEffect, useRef, useState } from 'react'
import Button from '../../components/ui/Button'
import { apiFetch } from '../../lib/api'
import StockDetailModal from '../../components/StockDetailModal'

type NewsItem = {
  title: string
  link: string
  source?: string
  date?: string
}

function decodeHtml(str: string): string {
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

type RelatedStock = { code: string; name: string }

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
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [relatedMap, setRelatedMap] = useState<Record<string, RelatedStock[]>>({})
  const [relatedLoadingSet, setRelatedLoadingSet] = useState<Set<string>>(new Set())
  const [relatedOpenSet, setRelatedOpenSet] = useState<Set<string>>(new Set())
  const [modalStock, setModalStock] = useState<RelatedStock | null>(null)
  const [baseStock, setBaseStock] = useState<RelatedStock | null>(null)
  const fetchedRelated = useRef<Set<string>>(new Set())

  const load = async (nextQuery = appliedQuery) => {
    setLoading(true)
    setError(null)
    try {
      const endpoint = nextQuery.trim()
        ? `/api/ui/news?q=${encodeURIComponent(nextQuery.trim())}`
        : '/api/ui/news'
      const res = await apiFetch(endpoint, { cacheMs: 20_000, timeoutMs: 12_000 })
      setItems(Array.isArray(res?.data) ? res.data : [])
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

  useEffect(() => { void load('') }, [])

  const applyQuery = () => {
    const next = query.trim()
    setAppliedQuery(next)
    void load(next)
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
  const emptyCount = Math.max(0, 30 - dataRowCount)

  /*
   * ──────────────────────────────────────────────────────────────
   * ▶ row-num 셀을 완전히 제거한 4열 구조
   *   xls-content-data 안에서 display:none 된 row-num td가
   *   나머지 열을 한 칸씩 앞으로 당기는 버그를 근본 해결
   * ──────────────────────────────────────────────────────────────
   */
  const colGroup = (
    <colgroup>
      <col style={{ width: '55%' }} />  {/* 제목 */}
      <col style={{ width: '15%' }} />  {/* 출처 */}
      <col style={{ width: '14%' }} />  {/* 일자 */}
      <col style={{ width: '16%' }} />  {/* 관련주 */}
    </colgroup>
  )

  return (
    <div className="news-sheet xls-page-inset">

      {/* ═══ 메타 헤더 테이블 ═══ */}
      <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
        {colGroup}
        <tbody>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={3}
              style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-brand)', letterSpacing: '0.01em' }}>
              뉴스
            </td>
            <td className="xls-cell" style={{ textAlign: 'right', padding: '1px 4px' }}>
              <Button variant="secondary" onClick={() => load(appliedQuery)} disabled={loading}>
                새로고침
              </Button>
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" colSpan={4}
              style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>
              텔레그램 /news 명령과 같은 뉴스 소스를 웹에서도 조회합니다.
            </td>
          </tr>
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

      {/* ═══ 데이터 테이블 (sticky 헤더) ═══ */}
      <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
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
                <Button variant="secondary" onClick={() => load(appliedQuery)}>재시도</Button>
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
            const rowNumber = idx + 1
            const isEven = rowNumber % 2 === 0
            return (
              <React.Fragment key={`${item.link}-${idx}`}>
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
                      variant="ghost"
                      onClick={() => toggleRelated(item)}
                      style={{ whiteSpace: 'nowrap', width: '100%', justifyContent: 'center' }}
                    >
                      관련주 {relatedOpenSet.has(key) ? '▲' : '▼'}
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
                              <Button key={s.code} variant="ghost" onClick={() => openModal(s)}>
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

          {/* 빈 행으로 그리드 채우기 */}
          {!loading && !error && Array.from({ length: emptyCount }, (_, idx) => {
            const rn = dataRowCount + idx + 1
            return (
              <tr key={`empty-${rn}`} className={`xls-row${rn % 2 === 0 ? ' xls-row--even' : ''}`}>
                <td className="xls-cell xls-cell--empty" />
                <td className="xls-cell xls-cell--empty" />
                <td className="xls-cell xls-cell--empty" />
                <td className="xls-cell xls-cell--empty" />
              </tr>
            )
          })}

        </tbody>
      </table>

      <StockDetailModal
        code={modalStock?.code ?? ''}
        name={modalStock?.name ?? ''}
        isOpen={!!modalStock}
        onClose={closeModal}
      />
    </div>
  )
}
