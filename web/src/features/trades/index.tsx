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
    <section>
      <h1 className="title-xl">거래 기록 / 결정 로그</h1>
      <div className="cards-list">
        {loading && <Skeleton lines={3} height={18} />}
        {!loading && rows.length === 0 && <div className="card">기록 없음</div>}
        {!loading && rows.map((r: any) => (
          <div key={r.id} className="card">
            <div className="flex-between">
              <div className="font-medium">{r.stock_name || r.ticker || r.symbol || r.code} ({r.code || '-'}) · {r.action}</div>
              <div className="muted">{new Date(r.created_at).toLocaleString()}</div>
            </div>
            <div className="muted mt-1">이유: {r.reason_summary ?? r.reason ?? r.notes ?? '-'}</div>
          </div>
        ))}
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onChange={(p) => setPage(p)} />
    </section>
  )
}
