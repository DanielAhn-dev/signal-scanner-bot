import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState, EmptyState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
import Pagination from '../../components/Pagination'

const SCAN_SNAPSHOT_KEY = 'scan_snapshot_v1'

function readScanSnapshot() {
  try {
    const raw = sessionStorage.getItem(SCAN_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.candidates)) return null
    return {
      candidates: parsed.candidates as ScanCandidate[],
      total: Number(parsed.total || 0),
      latestDate: parsed.latestDate ? String(parsed.latestDate) : null,
    }
  } catch {
    return null
  }
}

function writeScanSnapshot(payload: { candidates: ScanCandidate[]; total: number; latestDate: string | null }) {
  try {
    sessionStorage.setItem(SCAN_SNAPSHOT_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

type SortDirection = 'asc' | 'desc'
type SortKey =
  | 'code'
  | 'name'
  | 'sector_id'
  | 'entry_grade'
  | 'entry_score'
  | 'trend_grade'
  | 'dist_grade'
  | 'pivot_grade'
  | 'warn_score'
  | 'liquidity'
  | 'trade_date'
  | 'stock_updated_at'

type ScanCandidate = {
  code: string
  name: string
  sector_id: string | null
  liquidity: number | null
  trade_date: string | null
  stock_updated_at: string | null
  entry_grade: string | null
  entry_score: number | null
  trend_grade: string | null
  dist_grade: string | null
  dist_pct: number | null
  pivot_grade: string | null
  vol_atr_grade: string | null
  warn_grade: string | null
  warn_score: number | null
}

function gradeScore(grade: string | null | undefined): number {
  if (!grade) return -1
  const g = String(grade).trim().toUpperCase()
  if (g === 'A') return 5
  if (g === 'B') return 4
  if (g === 'C') return 3
  if (g === 'D') return 2
  if (g === 'E') return 1
  return 0
}

function toComparableValue(item: ScanCandidate, key: SortKey): string | number {
  if (key === 'entry_grade' || key === 'trend_grade' || key === 'dist_grade' || key === 'pivot_grade') {
    return gradeScore(item[key])
  }
  const v = item[key]
  if (v == null) return ''
  if (typeof v === 'number') return v
  return String(v)
}

export default function ScanPage() {
  const snapshot = readScanSnapshot()
  const [candidates, setCandidates] = useState<ScanCandidate[]>(() => snapshot?.candidates ?? [])
  const [total, setTotal] = useState(() => snapshot?.total ?? 0)
  const [latestDate, setLatestDate] = useState<string | null>(() => snapshot?.latestDate ?? null)
  const [loading, setLoading] = useState(() => !snapshot)
  const [error, setError] = useState<string | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [selectedSector, setSelectedSector] = useState<string>('all')
  const [conditionFilter, setConditionFilter] = useState<'all' | 'entry' | 'trend' | 'accumulation' | 'stable'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('entry_score')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(1)
  const [addingCode, setAddingCode] = useState<string | null>(null)
  const pageSize = 20
  const toast = useToast()

  const loadCandidates = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/ui/scan-candidates?limit=80', {
        cacheMs: 10_000,
        timeoutMs: 25_000,
      })
      setCandidates(res?.data ?? [])
      setTotal(res?.count ?? 0)
      setLatestDate(res?.latestDate ?? null)
      writeScanSnapshot({
        candidates: res?.data ?? [],
        total: res?.count ?? 0,
        latestDate: res?.latestDate ?? null,
      })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCandidates() }, [])

  const triggerScan = async () => {
    setScanLoading(true)
    try {
      const res = await apiFetch('/api/ui/trigger-update', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 180_000,
        body: JSON.stringify({
          runScripts: true,
          pipeline: 'full-refresh',
        }),
      })
      if (res?.ok) {
        toast.show('스캔/DB 동기화 요청 완료 ✓')
        await loadCandidates()
      } else {
        const detail = res?.body?.error || res?.error || '스캔 요청 실패'
        toast.show(String(detail))
      }
    } catch (e: any) {
      toast.show(String(e?.message || e))
    } finally {
      setScanLoading(false)
    }
  }

  const sectors = useMemo(
    () => ['all', ...new Set(candidates.map((row) => row.sector_id).filter((v): v is string => !!v))],
    [candidates],
  )

  const filteredCandidates = useMemo(() => candidates.filter((item) => {
    if (selectedSector !== 'all' && item.sector_id !== selectedSector) return false
    if (conditionFilter === 'entry') return ['A', 'B'].includes(String(item.entry_grade || '').toUpperCase())
    if (conditionFilter === 'trend') return ['A', 'B'].includes(String(item.trend_grade || '').toUpperCase())
    if (conditionFilter === 'accumulation') return ['A', 'B'].includes(String(item.dist_grade || '').toUpperCase())
    if (conditionFilter === 'stable') return ['A', 'B'].includes(String(item.pivot_grade || '').toUpperCase())
    return true
  }), [candidates, selectedSector, conditionFilter])

  const sortedCandidates = useMemo(() => [...filteredCandidates].sort((a, b) => {
    const av = toComparableValue(a, sortKey)
    const bv = toComparableValue(b, sortKey)
    const result = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), 'ko-KR')
    return sortDirection === 'asc' ? result : -result
  }), [filteredCandidates, sortKey, sortDirection])

  const pagedCandidates = useMemo(() => {
    const from = (page - 1) * pageSize
    return sortedCandidates.slice(from, from + pageSize)
  }, [sortedCandidates, page])

  const totalPages = Math.ceil(sortedCandidates.length / pageSize)

  const displayRows = useMemo(() => pagedCandidates.map((s) => ({
    ...s,
    tradeDateText: s.trade_date ?? '—',
    updatedAtText: s.stock_updated_at
      ? new Date(s.stock_updated_at).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      : null,
    updatedDateText: s.stock_updated_at
      ? new Date(s.stock_updated_at).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      : '—',
  })), [pagedCandidates])

  useEffect(() => {
    setPage(1)
  }, [selectedSector, conditionFilter])

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection(key === 'code' || key === 'name' || key === 'sector_id' ? 'asc' : 'desc')
  }

  const addToWatchlist = async (code: string) => {
    if (!code) return
    setAddingCode(code)
    try {
      const res = await apiFetch('/api/ui/watchlist', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify({ code }),
      })
      if (res?.error) throw new Error(String(res.error))
      toast.show('관심 종목에 추가되었습니다 ✓')
    } catch (e: any) {
      toast.show(String(e?.message || e))
    } finally {
      setAddingCode(null)
    }
  }

  const renderSortableHeader = (label: string, key: SortKey) => {
    const active = sortKey === key
    const marker = active ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''
    return (
      <button
        type="button"
        onClick={() => onSort(key)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
          fontWeight: active ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}{marker}
      </button>
    )
  }

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>눌림목 스캐너</h1>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="ghost" onClick={loadCandidates} disabled={loading}>새로고침</Button>
          <Button variant="primary" onClick={triggerScan} disabled={scanLoading}>
            {scanLoading ? '동기화 중…' : '▶ 스캔 동기화 실행'}
          </Button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="muted">
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 'var(--font-weight-semibold)' }}>{sortedCandidates.length}</span>개 후보 ·
          최신 기준일 {latestDate ?? '—'} · 텔레그램 /scan 과 동일한 pullback 신호 후보를 표시합니다.
        </div>
      </div>

      <div className="card mb-4">
        <div className="muted" style={{ marginBottom: 'var(--space-2)' }}>필터</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          {[
            { key: 'all', label: '전체' },
            { key: 'entry', label: '진입(A/B)' },
            { key: 'trend', label: '추세(A/B)' },
            { key: 'accumulation', label: '매집(A/B)' },
            { key: 'stable', label: '세력선(A/B)' },
          ].map((option) => (
            <button
              key={option.key}
              className={`tag${conditionFilter === option.key ? ' active' : ''}`}
              onClick={() => setConditionFilter(option.key as typeof conditionFilter)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span className="muted">섹터</span>
          <select
            className="input"
            style={{ minWidth: 180 }}
            value={selectedSector}
            onChange={(e) => setSelectedSector(e.target.value)}
          >
            {sectors.map((sector) => (
              <option key={sector} value={sector}>{sector === 'all' ? '전체 섹터' : sector}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={loadCandidates} />}

      {loading && candidates.length === 0 ? (
        <div className="card"><Skeleton lines={6} height={16} /></div>
      ) : !error && sortedCandidates.length === 0 ? (
        <EmptyState title="스캔 결과 없음" description="스캔을 실행하거나 필터를 조정해 보세요." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border-default)', textAlign: 'left' }}>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('코드', 'code')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('종목명', 'name')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('섹터', 'sector_id')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('진입', 'entry_grade')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('진입점수', 'entry_score')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('추세', 'trend_grade')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('매집', 'dist_grade')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('세력선', 'pivot_grade')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('경고점수', 'warn_score')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('유동성', 'liquidity')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('기준일', 'trade_date')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>{renderSortableHeader('종목업데이트', 'stock_updated_at')}</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((s: any) => (
                <tr key={s.code} style={{ borderBottom: '1px solid var(--color-border-default)' }}>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'var(--font-family-mono)', color: 'var(--color-text-brand)' }}>{s.code}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 'var(--font-weight-medium)' }}>{s.name}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-secondary)' }}>{s.sector_id ?? '—'}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{s.entry_grade ?? '—'}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }} className="number">
                    {s.entry_score != null ? formatNumber(s.entry_score, 2) : '—'}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{s.trend_grade ?? '—'}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                    {s.dist_grade ?? '—'}
                    {s.dist_pct != null ? ` (${formatNumber(s.dist_pct, 2)}%)` : ''}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                    {s.pivot_grade ?? '—'}
                    {s.vol_atr_grade ? ` / ${s.vol_atr_grade}` : ''}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                    {s.warn_grade ?? '—'}{s.warn_score != null && s.warn_score > 0 ? ` (${Math.round(s.warn_score)}개)` : ''}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }} className="number number-right">{s.liquidity != null ? formatNumber(s.liquidity, 0) : '—'}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-tertiary)' }}>
                    {s.tradeDateText}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-tertiary)' }}>
                    {s.trade_date ? (
                      <div>
                        <div>{s.tradeDateText}</div>
                        {s.updatedAtText && (
                          <div style={{ fontSize: '0.85em', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                            업데이트(KST): {s.updatedAtText}
                          </div>
                        )}
                      </div>
                    ) : (
                      s.updatedDateText
                    )}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                    <Button
                      className="watchlist-icon-btn scan-watch-add-btn"
                      variant="ghost"
                      onClick={() => addToWatchlist(String(s.code))}
                      disabled={addingCode === String(s.code)}
                      title="관심 종목에 추가"
                    >
                      <span className="watchlist-btn-symbol" aria-hidden>+</span>
                      <span className="watchlist-btn-label">{addingCode === String(s.code) ? '추가중' : '추가'}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="pagination-wrap" style={{ marginTop: 'var(--space-3)' }}>
              <Pagination page={page} pageSize={pageSize} total={sortedCandidates.length} onChange={setPage} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
