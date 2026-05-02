import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState } from '../../components/StateViews'

export default function MarketPage() {
  const [summary, setSummary] = useState<any | null>(null)
  const [sectors, setSectors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, sec] = await Promise.all([
        apiFetch('/api/ui/summary', { cacheMs: 30_000 }),
        apiFetch('/api/ui/sectors',  { cacheMs: 60_000 }),
      ])
      setSummary(s?.data ?? null)
      setSectors(sec?.data ?? [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>시장 진단</h1>
        <Button variant="secondary" onClick={load} disabled={loading}>새로고침</Button>
      </div>

      <div className="card mb-4">
        <div className="muted">텔레그램 <code>/market</code>에 대응합니다.</div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <div className="card"><Skeleton lines={4} height={14} /></div>}

      {!loading && !error && summary && (
        <div className="cards-grid cols-2 mb-4">
          {[
            ['보유 포지션', summary.positions],
            ['미실현 손익', summary.unrealized_pnl_sum != null ? formatKrw(summary.unrealized_pnl_sum) : '—'],
            ['의사결정 수', summary.decisions],
            ['마지막 스캔', summary.last_scan_at ? new Date(summary.last_scan_at).toLocaleDateString('ko-KR') : '—'],
          ].map(([label, val]) => (
            <div key={label as string} className="card">
              <div className="stat-label">{label}</div>
              <div className="stat-value" style={{ fontSize: 'var(--font-size-lg)' }}>{val ?? '—'}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && sectors.length > 0 && (
        <div className="card">
          <div className="section-title mb-4" style={{ marginBottom: 'var(--space-3)' }}>섹터 목록</div>
          <div className="tag-list">
            {sectors.map((s: any) => (
              <span key={s.id} className="tag">{s.name}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
