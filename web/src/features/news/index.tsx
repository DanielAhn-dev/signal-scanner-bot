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

  useEffect(() => {
    void load('')
  }, [])

  const applyQuery = () => {
    const next = query.trim()
    setAppliedQuery(next)
    void load(next)
  }

  const toggleRelated = async (item: NewsItem) => {
    const key = item.link || item.title
    // 토글: 이미 열려있으면 닫기
    if (relatedOpenSet.has(key)) {
      setRelatedOpenSet(prev => { const s = new Set(prev); s.delete(key); return s })
      return
    }
    // 열기
    setRelatedOpenSet(prev => new Set(prev).add(key))
    // 이미 로드됐으면 재요청 X
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

  const renderedRows = items.length + items.reduce((acc, item) => {
    const key = item.link || item.title
    return acc + (relatedOpenSet.has(key) ? 1 : 0)
  }, 0)
  const minRenderRows = 24

  return (
    <section className="container-app news-sheet">
      <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed', marginBottom: 'var(--space-4)' }}>
        <colgroup>
          <col style={{ width: '18%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <tbody>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={4} style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-brand)' }}>
              뉴스
            </td>
            <td className="xls-cell" colSpan={2} style={{ textAlign: 'right' }}>
              <Button variant="secondary" onClick={() => load(appliedQuery)} disabled={loading}>새로고침</Button>
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" colSpan={6} style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>
              텔레그램 /news 명령과 같은 뉴스 소스를 웹에서도 조회합니다.
            </td>
          </tr>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={6} style={{ padding: '8px 10px' }}>
              <form
                style={{ display: 'flex', gap: 'var(--space-2)' }}
                onSubmit={(e) => {
                  e.preventDefault()
                  applyQuery()
                }}
              >
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="종목명 또는 코드 (비우면 시장 뉴스)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Button variant="primary" type="submit" disabled={loading}>조회</Button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="scan-table-wrap">
        <table className="xls-table news-sheet__list" style={{ width: '100%', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 34 }} />
            <col style={{ width: '58%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <thead>
            <tr className="xls-letter-row">
              <th className="xls-corner" />
              <th className="xls-col-letter">A</th>
              <th className="xls-col-letter">B</th>
              <th className="xls-col-letter">C</th>
              <th className="xls-col-letter">D</th>
            </tr>
            <tr className="xls-header-row">
              <th className="xls-row-num-header" />
              <th className="xls-th">제목</th>
              <th className="xls-th">출처</th>
              <th className="xls-th">일자</th>
              <th className="xls-th">관련주</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="xls-row xls-row--even">
                <td className="xls-row-num">1</td>
                <td className="xls-cell" colSpan={4} style={{ color: 'var(--color-text-tertiary)' }}>불러오는 중...</td>
              </tr>
            )}

            {!loading && error && (
              <tr className="xls-row xls-row--even">
                <td className="xls-row-num">1</td>
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
                <td className="xls-row-num">1</td>
                <td className="xls-cell" colSpan={4} style={{ color: 'var(--color-text-tertiary)' }}>
                  조건에 맞는 뉴스를 찾지 못했습니다.
                </td>
              </tr>
            )}

            {!loading && !error && items.map((item, idx) => {
              const key = item.link || item.title
              const rowNumber = idx + 1
              return (
                <React.Fragment key={`${item.link}-${idx}`}>
                  <tr className={`xls-row${rowNumber % 2 === 0 ? ' xls-row--even' : ''}`}>
                    <td className="xls-row-num">{rowNumber}</td>
                    <td className="xls-cell" style={{ fontSize: 12 }}>
                      <a href={item.link} target="_blank" rel="noreferrer" className="title-md" style={{ textDecoration: 'none' }}>
                        {decodeHtml(item.title)}
                      </a>
                    </td>
                    <td className="xls-cell">{item.source || '—'}</td>
                    <td className="xls-cell">{item.date || '—'}</td>
                    <td className="xls-cell">
                      <Button
                        variant="ghost"
                        onClick={() => toggleRelated(item)}
                        style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                      >
                        관련주 {relatedOpenSet.has(key) ? '▲' : '▼'}
                      </Button>
                    </td>
                  </tr>

                  {relatedOpenSet.has(key) && (() => {
                    const stocks = relatedMap[key]
                    const isLoading = relatedLoadingSet.has(key)
                    return (
                      <tr className={`xls-row${rowNumber % 2 === 0 ? '' : ' xls-row--even'}`}>
                        <td className="xls-row-num">{rowNumber}</td>
                        <td className="xls-cell" colSpan={4}>
                          {isLoading && <span className="caption muted">조회 중...</span>}
                          {!isLoading && stocks && stocks.length === 0 && (
                            <span className="caption muted">제목에서 종목을 찾지 못했습니다.</span>
                          )}
                          {!isLoading && stocks && stocks.length === 1 && (
                            <Button variant="ghost" onClick={() => openModal(stocks[0])}>
                              {stocks[0].name} 시세
                            </Button>
                          )}
                          {!isLoading && stocks && stocks.length > 1 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
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

            {!loading && !error && Array.from({ length: Math.max(0, minRenderRows - renderedRows) }, (_, idx) => {
              const rn = renderedRows + idx + 1
              return (
                <tr key={`empty-${rn}`} className={`xls-row${rn % 2 === 0 ? ' xls-row--even' : ''}`}>
                  <td className="xls-row-num">{rn}</td>
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

      <StockDetailModal
        code={modalStock?.code ?? ''}
        name={modalStock?.name ?? ''}
        isOpen={!!modalStock}
        onClose={closeModal}
      />
    </section>
  )
}
