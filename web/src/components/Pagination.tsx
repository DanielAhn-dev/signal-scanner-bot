import React from 'react'

type Props = {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}

export default function Pagination({ page, pageSize, total, onChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const prev = () => { if (page > 1) onChange(page - 1) }
  const next = () => { if (page < totalPages) onChange(page + 1) }

  return (
    <div style={{display:'flex',alignItems:'center',gap:8,marginTop:12}}>
      <button className="btn btn-small" onClick={() => onChange(1)} disabled={page === 1}>처음</button>
      <button className="btn btn-small" onClick={prev} disabled={page === 1}>이전</button>
      <div className="muted" style={{minWidth:120,textAlign:'center'}}>페이지 {page} / {totalPages} · 전체 {total}건</div>
      <button className="btn btn-small" onClick={next} disabled={page === totalPages}>다음</button>
      <button className="btn btn-small" onClick={() => onChange(totalPages)} disabled={page === totalPages}>마지막</button>
    </div>
  )
}
