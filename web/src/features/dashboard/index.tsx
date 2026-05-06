import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw } from '../../lib/format'
import { getCurrentUserChatId } from '../../lib/userContext'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState } from '../../components/StateViews'
import TelegramLinkCallout from '../../components/TelegramLinkCallout'
import { requestOpenProfileModal } from '../../lib/profileModal'

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
  const initSummary = useMemo(
    () => readSession<any>('dashboard_summary', SUMMARY_TTL)
      ?? readLS<any>(LS_SUMMARY_KEY, SUMMARY_TTL),
    [],
  )

  const initSectors = useMemo(
    () => readSession<any[]>('dashboard_sectors', SECTORS_TTL)
      ?? readLS<any[]>(LS_SECTORS_KEY, SECTORS_TTL) ?? [],
    [],
  )

  const [summary, setSummary] = useState<any | null>(initSummary)
  const [sectors, setSectors] = useState<any[]>(initSectors)
  const [loading, setLoading] = useState(!initSummary)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(initSummary ? Date.now() : null)
  const [pnlAuditMessage, setPnlAuditMessage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async ({ force = false, silent = false }: { force?: boolean; silent?: boolean } = {}) => {
    if (!silent) setRefreshing(true)
    if (force) setPnlAuditMessage('손익 점검 중...')
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const [summaryResult, sectorsResult] = await Promise.allSettled([
        apiFetch(`/api/ui/summary${force ? '?cacheMs=0' : ''}`, {
          cacheMs: force ? 0 : SUMMARY_TTL,
          timeoutMs: 15_000,
          retries: 1,
        }),
        apiFetch(`/api/ui/sectors?top=8${force ? '&cacheMs=0' : ''}`, {
          cacheMs: force ? 0 : SECTORS_TTL,
          timeoutMs: 12_000,
          retries: 1,
        }),
      ])

      const errs: string[] = []
      let hasSuccess = false

      if (summaryResult.status === 'fulfilled' && summaryResult.value?.data) {
        const data = summaryResult.value.data
        setSummary(data)
        writeSession('dashboard_summary', data)
        writeLS(LS_SUMMARY_KEY, data)
        hasSuccess = true
      } else if (summaryResult.status === 'rejected') {
        errs.push(summaryResult.reason?.message || String(summaryResult.reason))
      }

      if (sectorsResult.status === 'fulfilled' && sectorsResult.value?.data) {
        const data = sectorsResult.value.data
        setSectors(data)
        writeSession('dashboard_sectors', data)
        writeLS(LS_SECTORS_KEY, data)
        hasSuccess = true
      } else if (sectorsResult.status === 'rejected') {
        errs.push(sectorsResult.reason?.message || String(sectorsResult.reason))
      }

      if (hasSuccess) setLastUpdatedAt(Date.now())

      if (force && summaryResult.status === 'fulfilled' && summaryResult.value?.data) {
        try {
          const positionsJson = await apiFetch('/api/ui/positions?page=1&pageSize=200&includeLots=0&positionType=holding&cacheMs=0', {
            cacheMs: 0,
            timeoutMs: 15_000,
            retries: 0,
          })
          const rows = Array.isArray(positionsJson?.data) ? positionsJson.data : []
          const portfolioPnl = rows.reduce((acc: number, row: any) => acc + Number(row?.unrealized_pnl || 0), 0)
          const dashboardPnl = Number(summaryResult.value.data?.unrealized_pnl_sum || 0)
          const diff = Math.round((dashboardPnl - portfolioPnl) * 100) / 100
          if (Math.abs(diff) < 0.01) {
            setPnlAuditMessage('손익 점검 완료: 대시보드/포트폴리오 일치')
          } else {
            setPnlAuditMessage(`손익 점검 경고: 차이 ${formatKrw(diff)}`)
          }
        } catch (auditErr: any) {
          setPnlAuditMessage(`손익 점검 실패: ${String(auditErr?.message || auditErr)}`)
        }
      }

      if (errs.length > 0 && !silent) {
        setError(errs[0])
      }
    } finally {
      if (!silent) setLoading(false)
      if (!silent) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!initSummary) {
      void loadData()
      return
    }

    setLoading(false)
    // cached snapshot is shown immediately, then revalidated in background
    void loadData({ silent: true })
  }, [initSummary, loadData])

  const pnl = summary?.unrealized_pnl_sum ?? null
  const pnlClass = pnl != null ? (pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : '') : ''
  const topSector = sectors.length > 0 ? sectors[0]?.name : '-'
  const chatId = getCurrentUserChatId()
  const refreshLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '-'
  const lastScan = summary?.last_scan_at
    ? new Date(summary.last_scan_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-'

  const go = (r: string) => onNavigate?.(r)

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>대시보드</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div className="caption muted">
            {refreshing ? '업데이트 중...' : `마지막 갱신 ${refreshLabel}`}
          </div>
          <Button variant="secondary" onClick={() => loadData({ force: true })} disabled={loading || refreshing}>
            {refreshing ? '새로고침 중...' : '새로고침'}
          </Button>
        </div>
      </div>

      {pnlAuditMessage && (
        <div className="caption muted" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
          {pnlAuditMessage}
        </div>
      )}

      {error && <ErrorState message={error} onRetry={() => loadData({ force: true })} />}

      {!chatId && (
        <div className="mb-4">
          <TelegramLinkCallout
            title="아직 텔레그램 연동 전입니다"
            description="웹 기능은 바로 사용 가능하지만, 알림 전송/텔레그램 연동은 Chat ID 연결이 필요합니다."
            onAction={() => requestOpenProfileModal()}
          />
        </div>
      )}

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
