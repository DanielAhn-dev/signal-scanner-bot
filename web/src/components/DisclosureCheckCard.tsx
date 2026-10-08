import React, { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { dartViewerUrl, disclosureLines, disclosureSourceNote, type DisclosureItem } from '../lib/disclosureCheck'

type CheckData = { status: 'ok' | 'not_company' | 'no_key' | 'error'; items: DisclosureItem[] }

/** 종목 분석 화면 "이 종목 공시 점검" — 최근 1년 위험·희석 공시와 과거 검증 수치 (C42~C44) */
export default function DisclosureCheckCard({ code }: { code?: string | null }) {
  const [data, setData] = useState<CheckData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!code) return
    let disposed = false
    setLoading(true)
    setData(null)
    apiFetch(`/api/ui/stock-disclosures?code=${encodeURIComponent(code)}`, { cacheMs: 30 * 60_000, timeoutMs: 20_000, retries: 0 })
      .then((res) => { if (!disposed) setData(res?.data ?? null) })
      .catch(() => { if (!disposed) setData({ status: 'error', items: [] }) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [code])

  if (!code || data?.status === 'not_company' || data?.status === 'no_key') return null
  const lines = data?.status === 'ok' ? disclosureLines(data.items) : []
  const note = disclosureSourceNote()

  return (
    <section aria-label="이 종목 공시 점검" style={{ margin: 'var(--space-3, 12px) 0', padding: '10px 12px', border: '1px solid var(--color-border-default)', borderRadius: 6, lineHeight: 1.55 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>이 종목 공시 점검 <span className="caption muted" style={{ fontWeight: 400 }}>최근 1년 · DART</span></div>
      {loading && <div className="caption muted">공시를 확인하는 중…</div>}
      {!loading && data?.status === 'error' && <div className="caption muted">지금은 공시를 불러오지 못했어요. 잠시 뒤 다시 열어 보세요.</div>}
      {!loading && data?.status === 'ok' && lines.length === 0 && (
        <div>최근 1년 동안 주식 수가 늘어나는 공시(유상증자·전환사채)나 관리종목·실질심사·불성실공시·감자 같은 위험 공시가 없어요.</div>
      )}
      {lines.map((l) => (
        <div key={l.category} style={{ marginTop: 6, paddingLeft: 8, borderLeft: `3px solid var(${l.tone === 'risk' ? '--color-warning' : '--color-border-default'})` }}>
          <div>
            <strong>{l.label}</strong> {l.count}회
            <span className="caption muted"> · 최근 {l.lastDate} · </span>
            <a className="caption" href={dartViewerUrl(l.lastRceptNo)} target="_blank" rel="noreferrer">원문</a>
          </div>
          {l.evidence && <div className="caption" style={{ color: 'var(--color-text-secondary)' }}>{l.evidence}</div>}
        </div>
      ))}
      {!loading && data?.status === 'ok' && (
        <div className="caption muted" style={{ marginTop: 6, fontSize: 10 }}>
          {lines.length > 0 && '공시가 났다고 꼭 떨어지는 건 아니에요. 매매 신호가 아니라, 크게 잃을 가능성이 평소보다 높았다는 참고예요. '}
          {note.text}{note.stale ? ' · ⚠️ 생성한 지 오래된 수치' : ''}
        </div>
      )}
    </section>
  )
}
