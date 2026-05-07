import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState, EmptyState } from '../../components/StateViews'
import StockDetailModal from '../../components/StockDetailModal'

type DecisionRow = {
  id?: number
  code?: string
  stock_name?: string
  action?: string
  created_at?: string
  reason_summary?: string
  buy_reason?: string | null
  sell_reason?: string | null
  detail_lines?: string[]
  trigger_label?: string
  is_auto?: boolean
}

export default function FeedPage() {
  const [decisions, setDecisions] = useState<DecisionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailCode, setDetailCode] = useState('')
  const [detailName, setDetailName] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/ui/decisions?pageSize=30', { cacheMs: 10_000, timeoutMs: 12_000, retries: 1 })
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
        <div className="muted">최근 자동매매 의사결정 30개를 표시합니다. 종목명, 자동/수동 구분, 매수·매도 사유와 상세 근거를 함께 확인할 수 있습니다.</div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <div className="card"><Skeleton lines={6} height={14} /></div>}

      {!loading && !error && decisions.length === 0 && (
        <EmptyState title="피드 없음" description="아직 의사결정 로그가 없습니다." />
      )}

      <div className="cards-list">
        {!loading && decisions.map((d: DecisionRow, i: number) => (
          <div
            key={d.id ?? i}
            className="card"
            role="button"
            tabIndex={0}
            onClick={() => {
              if (!d.code) return
              setDetailCode(String(d.code))
              setDetailName(String(d.stock_name ?? d.code))
              setDetailOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !d.code) return
              setDetailCode(String(d.code))
              setDetailName(String(d.stock_name ?? d.code))
              setDetailOpen(true)
            }}
          >
            <div className="flex-between">
              <div>
                <span style={{ fontWeight: 'var(--font-weight-bold)', color: ACTION_COLOR[d.action] ?? 'inherit', marginRight: 'var(--space-2)' }}>
                  {d.action}
                </span>
                <span className="title-md">{d.stock_name ?? d.code}</span>
                <span className="caption" style={{ marginLeft: 'var(--space-2)' }}>{d.code}</span>
                <span className="caption" style={{ marginLeft: 'var(--space-2)', color: d.is_auto ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
                  {d.is_auto ? '시스템 자동' : '수동/기타'}
                </span>
              </div>
              <div className="caption">
                {d.created_at ? new Date(d.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </div>
            {d.reason_summary && <div className="muted mt-1">요약: {d.reason_summary}</div>}
            {d.buy_reason && <div className="muted mt-1">매수 이유: {d.buy_reason}</div>}
            {d.sell_reason && <div className="muted mt-1">매도 이유: {d.sell_reason}</div>}
            {!!d.trigger_label && <div className="caption mt-1">트리거: {d.trigger_label}</div>}
            {!!d.detail_lines?.length && (
              <details className="mt-1" onClick={(e) => e.stopPropagation()}>
                <summary className="caption" style={{ cursor: 'pointer' }}>상세 근거 보기</summary>
                <div className="mt-1">
                  {d.detail_lines.map((line, idx) => (
                    <div key={`${d.id ?? i}-line-${idx}`} className="caption">• {line}</div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>

      <StockDetailModal
        code={detailCode}
        name={detailName}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </section>
  )
}
