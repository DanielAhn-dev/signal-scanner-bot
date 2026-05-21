import React, { useEffect, useRef, useState } from 'react'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState, EmptyState } from '../../components/StateViews'
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

  return (
    <section className="container-app">
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

      {error && <ErrorState message={error} onRetry={() => load(appliedQuery)} />}
      {loading && <div className="card"><Skeleton lines={6} height={14} /></div>}

      {!loading && !error && items.length === 0 && (
        <EmptyState title="뉴스 없음" description="조건에 맞는 뉴스를 찾지 못했습니다." />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="scan-table-wrap">
          <table className="scan-table xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
            <thead className="scan-thead">
              <tr>
                <th className="scan-th">제목</th>
                <th className="scan-th">출처</th>
                <th className="scan-th">일자</th>
                <th className="scan-th">관련주</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const key = item.link || item.title
                return (
                  <React.Fragment key={`${item.link}-${idx}`}>
                    <tr className="scan-tr" style={{ cursor: 'pointer' }}>
                      <td className="scan-td">
                        <a href={item.link} target="_blank" rel="noreferrer" className="title-md" style={{ textDecoration: 'none' }}>
                          {decodeHtml(item.title)}
                        </a>
                      </td>
                      <td className="scan-td">{item.source || '—'}</td>
                      <td className="scan-td">{item.date || '—'}</td>
                      <td className="scan-td">
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
                        <tr className="scan-tr xls-row--even">
                          <td className="scan-td" colSpan={4}>
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
            </tbody>
          </table>
        </div>
      )}

      <StockDetailModal
        code={modalStock?.code ?? ''}
        name={modalStock?.name ?? ''}
        isOpen={!!modalStock}
        onClose={closeModal}
      />
    </section>
  )
}
