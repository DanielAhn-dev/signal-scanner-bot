import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Skeleton from '../../components/Skeleton'
import Pagination from '../../components/Pagination'

export default function Trades() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState<number>(1)
  const [pageSize] = useState<number>(100)
  const [total, setTotal] = useState<number>(0)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const json = await apiFetch(`/api/ui/decisions?page=${page}&pageSize=${pageSize}`)
        if (mounted && json?.data) {
          setRows(json.data)
          setTotal(json.count || 0)
          setPage(json.page || page)
        }
      } catch (e) {
        console.error(e)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [page])

  return (
    <section className="container-app trades-page">
      <div className="trades-head">
        <h1 className="title-xl trades-title">거래 기록 / 결정 로그</h1>
        <p className="trades-subtitle">자동/수동 매수·매도 의사결정 로그를 최신순으로 확인합니다.</p>
      </div>

      <div className="cards-list trades-log-list">
        {loading && <Skeleton lines={3} height={18} />}
        {!loading && rows.length === 0 && <div className="card trades-empty-card">기록 없음</div>}
        {!loading && rows.map((r: any) => (
          <div key={r.id} className="card trades-log-card">
            <div className="trades-log-top">
              <div className="trades-log-title-wrap">
                <div className="trades-log-title">
                  {r.stock_name || r.ticker || r.symbol || r.code} ({r.code || '-'})
                  <span className={`trades-log-action ${String(r.action || '').toUpperCase() === 'BUY' ? 'is-buy' : 'is-sell'}`}>
                    {String(r.action || '-').toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="trades-log-time">{new Date(r.created_at).toLocaleString('ko-KR')}</div>
            </div>
            <div className="trades-log-reason">이유: {r.reason_summary ?? r.reason ?? r.notes ?? '-'}</div>
          </div>
        ))}
      </div>

      <div className="pagination-wrap trades-pagination-wrap">
        <Pagination page={page} pageSize={pageSize} total={total} onChange={(p) => setPage(p)} />
      </div>
    </section>
  )
}
