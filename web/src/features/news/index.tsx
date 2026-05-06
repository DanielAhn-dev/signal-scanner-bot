import React, { useEffect, useState } from 'react'
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

export default function NewsPage() {
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolvedCode, setResolvedCode] = useState<string>('')
  const [resolvedName, setResolvedName] = useState<string>('')
  const [detailOpen, setDetailOpen] = useState(false)

  const load = async (nextQuery = appliedQuery) => {
    setLoading(true)
    setError(null)
    try {
      const endpoint = nextQuery.trim()
        ? `/api/ui/news?q=${encodeURIComponent(nextQuery.trim())}`
        : '/api/ui/news'
      const res = await apiFetch(endpoint, { cacheMs: 20_000, timeoutMs: 12_000 })
      setItems(Array.isArray(res?.data) ? res.data : [])
      setResolvedCode(String(res?.code || ''))
      setResolvedName(String(res?.name || ''))
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

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>뉴스</h1>
        <Button variant="secondary" onClick={() => load(appliedQuery)} disabled={loading}>새로고침</Button>
      </div>

      <div className="card mb-4">
        <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
          텔레그램 <code>/news</code> 명령과 같은 뉴스 소스를 웹에서도 조회합니다.
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="종목명 또는 코드 (비우면 시장 뉴스)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyQuery()}
          />
          <Button variant="primary" onClick={applyQuery} disabled={loading}>조회</Button>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => load(appliedQuery)} />}
      {loading && <div className="card"><Skeleton lines={6} height={14} /></div>}

      {!loading && !error && items.length === 0 && (
        <EmptyState title="뉴스 없음" description="조건에 맞는 뉴스를 찾지 못했습니다." />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="cards-list">
          {items.map((item, idx) => (
            <article key={`${item.link}-${idx}`} className="card">
              <div className="flex-between" style={{ gap: 'var(--space-2)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a href={item.link} target="_blank" rel="noreferrer" className="title-md" style={{ textDecoration: 'none' }}>
                    {item.title}
                  </a>
                  <div className="caption muted" style={{ marginTop: 'var(--space-2)' }}>
                    {[item.source, item.date].filter(Boolean).join(' · ') || '출처 정보 없음'}
                  </div>
                </div>
                {resolvedCode && (
                  <Button variant="ghost" onClick={() => setDetailOpen(true)}>종목 시세</Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <StockDetailModal
        code={resolvedCode}
        name={resolvedName}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </section>
  )
}
