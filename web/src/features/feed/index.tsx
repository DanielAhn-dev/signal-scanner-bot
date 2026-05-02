import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState, EmptyState } from '../../components/StateViews'

export default function FeedPage() {
  const [decisions, setDecisions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/ui/decisions?pageSize=30', { cacheMs: 10_000 })
      setDecisions(res?.data ?? [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const ACTION_COLOR: Record<string, string> = {
    BUY: 'var(--color-stock-up)',
    SELL: 'var(--color-stock-down)',
    HOLD: 'var(--color-text-tertiary)',
  }

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>의사결정 피드</h1>
        <Button variant="secondary" onClick={load} disabled={loading}>새로고침</Button>
      </div>

      <div className="card mb-4">
        <div className="muted">텔레그램 <code>/feed</code>에 대응합니다. 최근 자동매매 의사결정 30개를 표시합니다.</div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <div className="card"><Skeleton lines={6} height={14} /></div>}

      {!loading && !error && decisions.length === 0 && (
        <EmptyState title="피드 없음" description="아직 의사결정 로그가 없습니다." />
      )}

      <div className="cards-list">
        {!loading && decisions.map((d: any, i: number) => (
          <div key={d.id ?? i} className="card">
            <div className="flex-between">
              <div>
                <span style={{ fontWeight: 'var(--font-weight-bold)', color: ACTION_COLOR[d.action] ?? 'inherit', marginRight: 'var(--space-2)' }}>
                  {d.action}
                </span>
                <span className="title-md">{d.stock_name ?? d.code}</span>
                <span className="caption" style={{ marginLeft: 'var(--space-2)' }}>{d.code}</span>
              </div>
              <div className="caption">
                {d.created_at ? new Date(d.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </div>
            {d.reason && <div className="muted mt-1">{d.reason}</div>}
          </div>
        ))}
      </div>
    </section>
  )
}
