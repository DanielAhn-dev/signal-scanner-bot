import React, { useState, useRef } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'

export default function AnalyzePage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const analyze = async (code?: string) => {
    const q = code ?? query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(q)}`, { cacheMs: 10_000 })
      if (res?.data) setResult(res.data)
      else setError(res?.error || '조회 결과 없음')
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const quick = ['005930', '000660', '035420', '051910', '207940']

  return (
    <section className="container-app">
      <h1 className="title-xl">종목 분석</h1>

      <div className="card mb-4">
        <div className="muted mb-4" style={{ marginBottom: 'var(--space-3)' }}>
          종목 코드(6자리) 또는 종목명으로 검색합니다. 텔레그램 <code>/analyze</code> 에 대응합니다.
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            ref={inputRef}
            className="input"
            style={{ flex: 1 }}
            placeholder="예: 005930 또는 삼성전자"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyze()}
          />
          <Button variant="primary" onClick={() => analyze()} disabled={loading || !query.trim()}>
            {loading ? '조회 중…' : '분석'}
          </Button>
        </div>
        <div className="tag-list" style={{ marginTop: 'var(--space-3)' }}>
          {quick.map(c => (
            <button key={c} className="tag" onClick={() => { setQuery(c); analyze(c) }}>{c}</button>
          ))}
        </div>
      </div>

      {loading && <div className="card"><Skeleton lines={5} height={14} /></div>}

      {error && (
        <div className="state-error">
          <div className="state-error-title">{error}</div>
        </div>
      )}

      {result && !loading && (
        <div className="card card-lg">
          <div className="flex-between mb-4">
            <div>
              <div className="title-lg">{result.name ?? result.code}</div>
              <div className="caption">{result.code}</div>
            </div>
            {result.close != null && (
              <div className="text-right">
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatKrw(result.close)}
                </div>
                {result.change_pct != null && (
                  <div className={result.change_pct > 0 ? 'positive' : result.change_pct < 0 ? 'negative' : 'neutral'}>
                    {result.change_pct > 0 ? '+' : ''}{formatNumber(result.change_pct, 2)}%
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="cards-grid cols-2">
            {[
              ['날짜', result.date ?? '—'],
              ['시가', result.open != null ? formatKrw(result.open) : '—'],
              ['고가', result.high != null ? formatKrw(result.high) : '—'],
              ['저가', result.low != null ? formatKrw(result.low) : '—'],
              ['거래량', result.volume != null ? formatNumber(result.volume, 0) : '—'],
              ['시가총액', result.market_cap != null ? formatKrw(result.market_cap) : '—'],
            ].map(([label, val]) => (
              <div key={label as string}>
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{ fontSize: 'var(--font-size-lg)' }}>{val}</div>
              </div>
            ))}
          </div>

          {result.sector && (
            <div className="mt-4 caption">섹터: {result.sector}</div>
          )}
        </div>
      )}
    </section>
  )
}
