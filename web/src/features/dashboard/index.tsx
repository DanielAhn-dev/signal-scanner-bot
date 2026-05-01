import React, { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw } from '../../lib/format'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState } from '../../components/StateViews'

const SUMMARY_TTL = 30_000
const SECTORS_TTL = 120_000
const LS_SUMMARY_KEY = 'ls_dashboard_summary'
const LS_SECTORS_KEY = 'ls_dashboard_sectors'

function readSession<T>(key: string, ttl: number): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.ts && Date.now() - parsed.ts < ttl) return parsed.data as T
  } catch { /* ignore */ }
  return null
}
function writeSession(key: string, data: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })) } catch { /* ignore */ }
}
function readLS<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.ts && Date.now() - parsed.ts < ttl) return parsed.data as T
  } catch { /* ignore */ }
  return null
}
function writeLS(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })) } catch { /* ignore */ }
}

export default function Dashboard({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const initSummary = readSession<any>('dashboard_summary', SUMMARY_TTL)
    ?? readLS<any>(LS_SUMMARY_KEY, SUMMARY_TTL)

  const initSectors = readSession<any[]>('dashboard_sectors', SECTORS_TTL)
    ?? readLS<any[]>(LS_SECTORS_KEY, SECTORS_TTL) ?? []

  const [summary, setSummary] = useState<any | null>(initSummary)
  const [sectors, setSectors] = useState<any[]>(initSectors)
  const [loading, setLoading] = useState(!initSummary)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    const [summaryResult, sectorsResult] = await Promise.allSettled([
      apiFetch('/api/ui/summary', {
        cacheMs: force ? 0 : SUMMARY_TTL,
        timeoutMs: 15_000,
        retries: 1,
      }),
      apiFetch('/api/ui/sectors?top=8', {
        cacheMs: force ? 0 : SECTORS_TTL,
        timeoutMs: 12_000,
        retries: 1,
      }),
    ])

    const errs: string[] = []

    if (summaryResult.status === 'fulfilled' && summaryResult.value?.data) {
      const data = summaryResult.value.data
      setSummary(data)
      writeSession('dashboard_summary', data)
      writeLS(LS_SUMMARY_KEY, data)
    } else if (summaryResult.status === 'rejected') {
      errs.push(summaryResult.reason?.message || String(summaryResult.reason))
    }

    if (sectorsResult.status === 'fulfilled' && sectorsResult.value?.data) {
      const data = sectorsResult.value.data
      setSectors(data)
      writeSession('dashboard_sectors', data)
      writeLS(LS_SECTORS_KEY, data)
    } else if (sectorsResult.status === 'rejected') {
      errs.push(sectorsResult.reason?.message || String(sectorsResult.reason))
    }

    if (errs.length > 0) {
      setError(errs[0])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    if (!initSummary) loadData()
    else setLoading(false)
  }, [initSummary, loadData])

  const pnl = summary?.unrealized_pnl_sum ?? null
  const pnlClass = pnl != null ? (pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : '') : ''
  const topSector = sectors.length > 0 ? sectors[0]?.name : '-'
  const lastScan = summary?.last_scan_at
    ? new Date(summary.last_scan_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-'

  const go = (r: string) => onNavigate?.(r)

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>대시보드</h1>
        <Button variant="secondary" onClick={() => loadData(true)} disabled={loading}>
          {loading ? '로딩...' : '새로고침'}
        </Button>
      </div>

      {error && <ErrorState message={error} onRetry={() => loadData(true)} />}

      <div className="cards-grid cols-2 mb-4">
        {loading && !summary ? (
          [0,1,2,3].map(i => <div key={i} className="card"><Skeleton lines={2} height={14} /></div>)
        ) : (
          <>
            <div className="card stat-card" onClick={() => go('portfolio')} role="button" tabIndex={0}
              style={{ cursor: 'pointer' }} onKeyDown={e => e.key === 'Enter' && go('portfolio')}>
              <div className="stat-label">보유 종목</div>
              <div className="stat-value">
                {summary?.positions ?? '-'}{summary?.positions != null && <span className="stat-unit">종목</span>}
              </div>
              <div className="stat-sub">가상 포트폴리오 →</div>
            </div>

            <div className="card stat-card">
              <div className="stat-label">미실현 손익</div>
              <div className={`stat-value ${pnlClass}`}>
                {pnl != null ? formatKrw(pnl) : '-'}
              </div>
              <div className="stat-sub">평가손익 합계</div>
            </div>

            <div className="card stat-card">
              <div className="stat-label">마지막 스캔</div>
              <div className="stat-value stat-value--sm">{lastScan}</div>
              <div className="stat-sub">스캔 실행 시각</div>
            </div>

            <div className="card stat-card" onClick={() => go('sectors')} role="button" tabIndex={0}
              style={{ cursor: 'pointer' }} onKeyDown={e => e.key === 'Enter' && go('sectors')}>
              <div className="stat-label">1위 섹터</div>
              <div className="stat-value stat-value--sm">{topSector}</div>
              <div className="stat-sub">섹터 페이지 →</div>
            </div>
          </>
        )}
      </div>

      <div className="mb-4">
        <div className="flex-between" style={{ marginBottom: 'var(--space-3)' }}>
          <div className="title-md">유망 섹터 Top 8</div>
          <button style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--color-brand)', fontSize: 'var(--font-size-sm)' }}
            onClick={() => go('sectors')}>전체 보기 →</button>
        </div>

        {loading && sectors.length === 0 ? (
          <div className="cards-grid cols-2">
            {[0,1,2,3].map(i => <div key={i} className="card"><Skeleton lines={2} height={12} /></div>)}
          </div>
        ) : sectors.length === 0 ? (
          <div className="card"><div className="muted">섹터 데이터 없음</div></div>
        ) : (
          <div className="cards-grid cols-2">
            {sectors.slice(0, 8).map((s: any, idx: number) => {
              const score = s.score != null ? Math.round(Number(s.score)) : null
              const cr = s.change_rate != null ? Number(s.change_rate) : null
              const crClass = cr != null ? (cr > 0 ? 'positive' : cr < 0 ? 'negative' : 'neutral') : ''
              return (
                <div key={s.id} className="card sector-mini-card" onClick={() => go('sectors')}
                  role="button" tabIndex={0} style={{ cursor: 'pointer' }}
                  onKeyDown={e => e.key === 'Enter' && go('sectors')}
                >
                  <div className="sector-mini-rank">#{idx + 1}</div>
                  <div className="sector-mini-name">{s.name}</div>
                  <div className="sector-mini-footer">
                    {score != null && <span className="sector-mini-score">{score}점</span>}
                    {cr != null && (
                      <span className={`sector-mini-cr ${crClass}`}>
                        {cr >= 0 ? '+' : ''}{cr.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
