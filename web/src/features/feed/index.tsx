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
              의사결정 피드
            </td>
            <td className="xls-cell" colSpan={2} style={{ textAlign: 'right' }}>
              <Button variant="secondary" onClick={load} disabled={loading}>새로고침</Button>
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" colSpan={6} style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>
              최근 자동매매 의사결정 30개를 표시합니다. 종목명, 자동/수동 구분, 매수·매도 사유와 상세 근거를 함께 확인할 수 있습니다.
            </td>
          </tr>
        </tbody>
      </table>

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <div className="card"><Skeleton lines={6} height={14} /></div>}

      {!loading && !error && decisions.length === 0 && (
        <EmptyState title="피드 없음" description="아직 의사결정 로그가 없습니다." />
      )}

      <div className="scan-table-wrap">
        <table className="scan-table xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
          <thead className="scan-thead">
            <tr>
              <th className="scan-th">액션</th>
              <th className="scan-th">종목</th>
              <th className="scan-th">구분</th>
              <th className="scan-th">시간</th>
              <th className="scan-th">상세</th>
            </tr>
          </thead>
          <tbody>
            {!loading && decisions.map((d: DecisionRow, i: number) => {
              const key = d.link || `${d.id ?? i}`
              return (
                <React.Fragment key={key}>
                  <tr
                    className={`scan-tr`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      if (!d.code) return
                      setDetailCode(String(d.code))
                      setDetailName(String(d.stock_name ?? d.code))
                      setDetailOpen(true)
                    }}
                  >
                    <td className="scan-td" style={{ fontWeight: 'var(--font-weight-bold)', color: ACTION_COLOR[d.action] ?? 'inherit' }}>{d.action || '—'}</td>
                    <td className="scan-td">{d.stock_name ?? d.code}</td>
                    <td className="scan-td" style={{ color: d.is_auto ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>{d.is_auto ? '시스템 자동' : '수동/기타'}</td>
                    <td className="scan-td">{d.created_at ? new Date(d.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="scan-td">{d.reason_summary || d.buy_reason || d.sell_reason || d.trigger_label || '—'}</td>
                  </tr>
                  {!!d.detail_lines?.length && (
                    <tr className="scan-tr xls-row--even">
                      <td className="scan-td" colSpan={5}>
                        <details onClick={(e) => e.stopPropagation()}>
                          <summary className="caption" style={{ cursor: 'pointer' }}>상세 근거 보기</summary>
                          <div className="mt-1">
                            {d.detail_lines.map((line, idx) => (
                              <div key={`${d.id ?? i}-line-${idx}`} className="caption">• {line}</div>
                            ))}
                          </div>
                        </details>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
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
