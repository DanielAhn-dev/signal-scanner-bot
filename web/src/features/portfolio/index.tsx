import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { apiFetch, invalidateCache } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Skeleton from '../../components/Skeleton'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/Modal'
import { EmptyState, ErrorState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
import Pagination from '../../components/Pagination'
import useWatchlistActions from '../../hooks/useWatchlistActions'

export default function Portfolio() {
  const [allRows, setAllRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedSector, setSelectedSector] = useState<string | null>(null)
  const [positionFilter, setPositionFilter] = useState<'all' | 'holding' | 'interest'>('all')
  const [showAllSectors, setShowAllSectors] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalRow, setModalRow] = useState<any | null>(null)
  const [modalSide, setModalSide] = useState<'buy' | 'sell'>('buy')
  const [tradeQty, setTradeQty] = useState(1)
  const [tradePrice, setTradePrice] = useState<number | ''>('')
  const [tradeLoading, setTradeLoading] = useState(false)
  const [tradeError, setTradeError] = useState<string | null>(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [maintModalOpen, setMaintModalOpen] = useState(false)
  const [maintMode, setMaintMode] = useState<'watchreset' | 'liquidateall' | 'holdingedit' | 'holdingrestore'>('watchreset')
  const [maintRow, setMaintRow] = useState<any | null>(null)
  const [maintCode, setMaintCode] = useState('')
  const [maintBuyPrice, setMaintBuyPrice] = useState<number | ''>('')
  const [maintQty, setMaintQty] = useState<number>(1)
  const [maintLoading, setMaintLoading] = useState(false)
  const [maintError, setMaintError] = useState<string | null>(null)
  const toast = useToast()
  const { isRemoving, removeFromWatchlist } = useWatchlistActions()

  const load = useCallback(async ({ soft = false, force = false }: { soft?: boolean; force?: boolean } = {}) => {
    setRefreshing(true)
    if (!soft) setLoading(true)
    if (!soft) setError(null)
    try {
      // 초기 로드 pageSize를 20으로 제한 → 초기 응답 시간 8초에서 1초 이하로 단축
      const params = new URLSearchParams({ page: '1', pageSize: '20', includeLots: '0' })
      if (force) params.set('cacheMs', '0')
      const json = await apiFetch(`/api/ui/positions?${params}`, { cacheMs: 3_000, timeoutMs: 15_000, retries: 1 })
      setAllRows(json?.data ?? [])
      setLastUpdatedAt(Date.now())
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (!soft) setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 클라이언트 사이드 파생 상태 – API 재호출 없이 즉시 필터링
  const holdingAll = useMemo(() => allRows.filter((r: any) => r.position_type === 'holding'), [allRows])
  const interestAll = useMemo(() => allRows.filter((r: any) => r.position_type !== 'holding'), [allRows])

  const sectors = useMemo(() => {
    const base = positionFilter === 'holding' ? holdingAll : positionFilter === 'interest' ? interestAll : allRows
    const seen = new Map<string, { id: string; name: string }>()
    for (const r of base) {
      const s = r.stock?.sector
      if (s?.id && s?.name && !seen.has(String(s.id))) {
        seen.set(String(s.id), { id: String(s.id), name: String(s.name) })
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [allRows, positionFilter, holdingAll, interestAll])

  const filteredRows = useMemo(() => {
    let result: any[] = positionFilter === 'holding' ? holdingAll : positionFilter === 'interest' ? interestAll : allRows
    if (selectedSector) result = result.filter((r: any) => String(r.stock?.sector_id ?? '') === selectedSector)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((r: any) =>
        (r.code || '').toLowerCase().includes(q) ||
        (r.stock_name || '').toLowerCase().includes(q)
      )
    }
    return result
  }, [allRows, positionFilter, selectedSector, search, holdingAll, interestAll])

  const total = filteredRows.length
  const totalPages = Math.ceil(total / pageSize)
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
  const totalUnrealized = holdingAll.reduce((acc: number, r: any) => acc + Number(r.unrealized_pnl || 0), 0)
  const totalInvested = holdingAll.reduce((acc: number, r: any) => acc + (Number(r.quantity || 0) * Number(r.avg_price || 0)), 0)
  const totalReturnPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0
  const captureGeneratedAt = useMemo(
    () => new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date()),
    [shareModalOpen],
  )

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSearchChange = (v: string) => {
    setSearchInput(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(v)
      setPage(1)
    }, 220)
  }
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const openTradeModal = (row: any, side: 'buy' | 'sell') => {
    setModalRow(row)
    setModalSide(side)
    setTradeQty(side === 'buy' ? (row.recommended_buy_qty || 1) : (row.quantity || 1))
    setTradePrice(row.stock?.close ?? row.avg_price ?? '')
    setTradeError(null)
    setModalOpen(true)
  }

  const openMaintenanceModal = (mode: 'watchreset' | 'liquidateall' | 'holdingedit' | 'holdingrestore', row?: any) => {
    setMaintMode(mode)
    setMaintRow(row ?? null)
    setMaintError(null)
    if (mode === 'holdingedit') {
      const code = String(row?.code || '')
      setMaintCode(code)
      setMaintBuyPrice(Number(row?.avg_price || row?.buy_price || row?.stock?.close || 0) || '')
      setMaintQty(Math.max(1, Number(row?.quantity || 1)))
    }
    if (mode === 'holdingrestore') {
      setMaintCode('')
      setMaintBuyPrice('')
      setMaintQty(1)
    }
    setMaintModalOpen(true)
  }

  const runMaintenance = async () => {
    setMaintLoading(true)
    setMaintError(null)
    try {
      const body: any = { mode: maintMode }
      if (maintMode === 'holdingedit' || maintMode === 'holdingrestore') {
        body.code = maintCode
        body.buy_price = maintBuyPrice
        body.quantity = maintQty
      }

      const json = await apiFetch('/api/ui/positions-maintenance', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 20_000,
        body: JSON.stringify(body),
      })
      if (json?.error) throw new Error(String(json.error))

      if (maintMode === 'watchreset') {
        toast.show(`관심 종목 ${Number(json?.removed || 0)}건 초기화 완료`)
      } else if (maintMode === 'liquidateall') {
        toast.show(`보유 종목 ${Number(json?.soldCount || 0)}건 전체매도 처리 완료`)
      } else if (maintMode === 'holdingrestore') {
        const label = json?.data?.stock_name || json?.data?.code || maintCode
        const action = json?.created ? '신규 복구' : '기존 포지션 수정'
        toast.show(`${label} 보유복구(${action}) 완료 ✓`)
      } else {
        toast.show('보유수정 완료 ✓')
      }

      invalidateCache('/api/ui/positions')
      setMaintModalOpen(false)
      await load({ soft: true, force: true })
    } catch (e: any) {
      setMaintError(String(e?.message || e))
    } finally {
      setMaintLoading(false)
    }
  }

  const submitTrade = async () => {
    if (!modalRow) return
    if (!tradeQty || tradeQty <= 0) { setTradeError('수량은 1 이상이어야 합니다'); return }
    if (tradePrice !== '' && Number(tradePrice) <= 0) { setTradeError('가격은 0보다 커야 합니다'); return }

    setTradeLoading(true)
    setTradeError(null)
    try {
      const payload = {
        code: modalRow.code,
        side: modalSide === 'buy' ? 'BUY' : 'SELL',
        quantity: Number(tradeQty),
        price: tradePrice !== '' ? Number(tradePrice) : (modalRow.stock?.close ?? modalRow.avg_price ?? 0),
      }
      const json = await apiFetch('/api/ui/virtual-trade', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify(payload),
      })
      if (json?.error) {
        setTradeError(String(json?.error || '거래 실행 실패'))
      } else {
        toast.show(`${modalSide === 'buy' ? '매수' : '매도'} 등록 완료 ✓`)
        invalidateCache('/api/ui/positions')
        setModalOpen(false)
        load({ soft: true, force: true })
      }
    } catch (e: any) {
      setTradeError(String(e?.message || e))
    } finally {
      setTradeLoading(false)
    }
  }

  const visibleSectors = showAllSectors ? sectors : sectors.slice(0, 8)

  const onTabChange = (t: 'all' | 'holding' | 'interest') => {
    setPositionFilter(t)
    setSelectedSector(null)
    setPage(1)
  }

  const onSectorChange = (sectorId: string | null) => {
    setSelectedSector(sectorId)
    setPage(1)
  }

  const removeInterest = async (code: string) => {
    if (!code) return
    try {
      const result = await removeFromWatchlist(code)
      if (result !== 'removed' && result !== 'not-found') return
      setAllRows((prev) => prev.filter((row: any) => !(String(row?.code || '') === code && row?.position_type !== 'holding')))
      toast.show('관심 종목에서 제거되었습니다')
    } catch (e: any) {
      toast.show(String(e?.message || e))
    }
  }

  const formatSignedKrw = (value: number) => {
    const num = Number(value || 0)
    if (num === 0) return formatKrw(0)
    return `${num > 0 ? '+' : '-'}${formatKrw(Math.abs(num))}`
  }

  return (
    <section className="container-app portfolio-page">
      <div className="portfolio-head">
        <div className="portfolio-title-wrap">
          <h1 className="title-xl portfolio-title">가상 포트폴리오</h1>
          <p className="portfolio-subtitle">보유 포지션과 관심 종목을 한 화면에서 관리합니다.</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className="caption muted">
            {refreshing
              ? '업데이트 중...'
              : `마지막 갱신 ${lastUpdatedAt
                ? new Date(lastUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '-'}`}
          </span>
          <Button variant="secondary" onClick={() => load({ force: true })} disabled={loading || refreshing}>
            {refreshing ? '새로고침 중...' : '새로고침'}
          </Button>
          <span className="portfolio-total-pill">
            {allRows.length > 0 ? `총 ${allRows.length}개` : '포지션 집계 준비중'}
          </span>
          <Button variant="secondary" onClick={() => setShareModalOpen(true)} disabled={loading || holdingAll.length === 0}>캡처용 보기</Button>
          <Button variant="ghost" onClick={() => openMaintenanceModal('holdingrestore')} disabled={loading}>보유복구</Button>
          <Button variant="ghost" onClick={() => openMaintenanceModal('watchreset')} disabled={loading || interestAll.length === 0}>관심초기화</Button>
          <Button variant="ghost" onClick={() => openMaintenanceModal('liquidateall')} disabled={loading || holdingAll.length === 0}>전체매도</Button>
        </div>
      </div>

      <div className="portfolio-stat-grid">
        <div className="card portfolio-stat-card">
          <div className="stat-label">보유 종목</div>
          <div className="stat-value">{holdingAll.length}</div>
          <div className="stat-sub">실제 보유 상태</div>
        </div>
        <div className="card portfolio-stat-card">
          <div className="stat-label">관심 종목</div>
          <div className="stat-value">{interestAll.length}</div>
          <div className="stat-sub">매수 대기 항목</div>
        </div>
        <div className="card portfolio-stat-card">
          <div className="stat-label">평가손익 합계</div>
          <div className={`stat-value ${totalUnrealized < 0 ? 'negative' : 'positive'}`}>
            {formatKrw(totalUnrealized)}
          </div>
          <div className="stat-sub">보유 포지션 기준</div>
        </div>
      </div>

      {/* 필터 */}
      <div className="card mb-4 portfolio-filter-card">
        <div className="portfolio-filter-stack">
          <div>
            <div className="caption portfolio-filter-label">섹터</div>
            <div className="tag-list">
              <button
                className={`tag${!selectedSector ? ' active' : ''}`}
                onClick={() => onSectorChange(null)}
              >전체</button>
              {visibleSectors.map((s: any) => (
                <button
                  key={s.id}
                  className={`tag${selectedSector === s.id ? ' active' : ''}`}
                  onClick={() => onSectorChange(s.id)}
                >{s.name}</button>
              ))}
              {sectors.length > 8 && (
                <button className="tag" onClick={() => setShowAllSectors(v => !v)}>
                  {showAllSectors ? '접기' : `+ ${sectors.length - 8}개 더보기`}
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="caption portfolio-filter-label">포지션 유형</div>
            <div className="tag-list portfolio-segment-list">
              <button
                className={`tag${positionFilter === 'all' ? ' active' : ''}`}
                onClick={() => onTabChange('all')}
              >
                전체 ({allRows.length})
              </button>
              <button
                className={`tag${positionFilter === 'holding' ? ' active' : ''}`}
                onClick={() => onTabChange('holding')}
              >
                보유 ({holdingAll.length})
              </button>
              <button
                className={`tag${positionFilter === 'interest' ? ' active' : ''}`}
                onClick={() => onTabChange('interest')}
              >
                관심 ({interestAll.length})
              </button>
            </div>
          </div>

          <div className="portfolio-search-row">
            <input
              className="input portfolio-search-input"
              placeholder="코드 또는 종목명 검색"
              value={searchInput}
              onChange={e => onSearchChange(e.target.value)}
            />
            <Button className="portfolio-search-btn" variant="secondary" onClick={() => { setSearch(searchInput); setPage(1) }} disabled={loading}>
              검색
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="portfolio-error-wrap">
          <ErrorState message={error} onRetry={() => load({ force: true })} />
        </div>
      )}

      <div className="cards-list portfolio-cards-list">
        {loading && rows.length === 0 && <div className="card portfolio-loading-card"><Skeleton lines={5} height={18} /></div>}

        {!loading && !error && rows.length === 0 && (
          <EmptyState
            title={positionFilter === 'interest' ? '관심 종목 없음' : positionFilter === 'holding' ? '보유 포지션 없음' : '포지션 없음'}
            description={positionFilter === 'all' ? '텔레그램 /가상매수 또는 아래 버튼으로 포지션을 추가하세요.' : '선택한 유형에 해당하는 항목이 없습니다.'}
          />
        )}

        {!error && rows.map((r: any) => {
          const pnl = r.unrealized_pnl
          const isHolding = r.position_type === 'holding'
            const code = String(r.code || '')
          return (
            <div key={r.id} className="card card-lg portfolio-position-card">
              <div className="flex-between portfolio-position-top">
                <div>
                  <div className="title-lg">{r.stock_name ?? r.ticker ?? r.symbol}</div>
                  <div className="caption">{r.code}</div>
                  {isHolding ? (
                    <div className="muted portfolio-position-meta">
                      {r.quantity}주 · 매수가 {formatKrw(r.avg_price)}
                      {r.buy_date ? ` · ${r.buy_date}` : ''}
                    </div>
                  ) : (
                    <div className="muted portfolio-position-meta">
                      관심 항목 · 추천 매수: {r.recommended_buy_qty
                        ? `${r.recommended_buy_qty}주 (${formatKrw(r.recommended_buy_amount)})`
                        : '제안 없음'}
                    </div>
                  )}
                </div>

                <div className="text-right portfolio-position-pnl">
                  {isHolding ? (
                    <>
                      <div
                        className={pnl != null ? (pnl < 0 ? 'negative' : 'positive') : ''}
                        style={{ fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-xl)' }}
                      >
                        {pnl != null ? formatKrw(pnl) : '—'}
                      </div>
                      <div className="caption">
                        {r.unrealized_pct != null ? `${formatNumber(r.unrealized_pct, 2)}%` : '—'}
                        {r.hold_days != null ? ` · ${r.hold_days}일` : ''}
                      </div>
                    </>
                  ) : (
                    <span className="caption">관심</span>
                  )}
                </div>
              </div>

              {r.lots?.length > 0 && (
                <div className="caption portfolio-lots">
                  로트: {r.lots.map((l: any) => `${l.acquired_quantity}주 @${formatKrw(l.acquired_price)}`).join(' · ')}
                </div>
              )}

              <div className="portfolio-actions-row">
                <Button className="portfolio-action-btn" variant="secondary" onClick={() => openTradeModal(r, 'buy')}>가상매수</Button>
                {isHolding && <Button className="portfolio-action-btn" variant="secondary" onClick={() => openMaintenanceModal('holdingedit', r)}>보유수정</Button>}
                {isHolding && <Button className="portfolio-action-btn" variant="ghost" onClick={() => openTradeModal(r, 'sell')}>가상매도</Button>}
                {!isHolding && (
                  <Button
                    className="portfolio-action-btn"
                    variant="ghost"
                    onClick={() => removeInterest(code)}
                    disabled={isRemoving(code)}
                  >
                    {isRemoving(code) ? '관심제거중' : '관심제거'}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="pagination-wrap">
          <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        title={`가상${modalSide === 'buy' ? '매수' : '매도'}`}
        onClose={() => setModalOpen(false)}
        size="sm"
      >
        {modalRow && (
          <>
            <div className="muted" style={{ marginBottom: 'var(--space-4)' }}>
              <strong style={{ color: 'var(--color-text-primary)' }}>
                {modalRow.stock_name ?? modalRow.code}
              </strong>
              <span className="caption"> ({modalRow.code})</span>
            </div>

            <div className="grid-two" style={{ marginBottom: 'var(--space-4)' }}>
              <Input
                label="수량"
                type="number"
                value={String(tradeQty)}
                onChange={(e: any) => setTradeQty(Number(e.target.value))}
              />
              <Input
                label="가격 (미입력 시 현재가)"
                type="number"
                value={tradePrice === '' ? '' : String(tradePrice)}
                onChange={(e: any) => setTradePrice(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>

            {tradeError && (
              <div className="state-error" style={{ marginBottom: 'var(--space-3)' }}>
                <div className="state-error-title">{tradeError}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant="primary" onClick={submitTrade} disabled={tradeLoading}>
                {tradeLoading ? '처리 중…' : '실행'}
              </Button>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>취소</Button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        isOpen={shareModalOpen}
        title="포트폴리오 캡처"
        onClose={() => setShareModalOpen(false)}
        size="lg"
      >
        <div className="portfolio-capture-card">
          <div className="portfolio-capture-top">
            <div>
              <div className="portfolio-capture-title">가상 포트폴리오 공유용 요약</div>
              <div className="portfolio-capture-time">기준시각 {captureGeneratedAt}</div>
            </div>
            <div className="portfolio-capture-count">보유 {holdingAll.length}종목</div>
          </div>

          <div className="portfolio-capture-metrics">
            <div className="portfolio-capture-metric">
              <div className="portfolio-capture-label">총 매수원금</div>
              <div className="portfolio-capture-value">{formatKrw(totalInvested)}</div>
            </div>
            <div className="portfolio-capture-metric">
              <div className="portfolio-capture-label">평가손익</div>
              <div className={`portfolio-capture-value ${totalUnrealized < 0 ? 'negative' : 'positive'}`}>
                {formatSignedKrw(totalUnrealized)}
              </div>
            </div>
            <div className="portfolio-capture-metric">
              <div className="portfolio-capture-label">현재 수익률</div>
              <div className={`portfolio-capture-value ${totalReturnPct < 0 ? 'negative' : 'positive'}`}>
                {`${totalReturnPct > 0 ? '+' : ''}${formatNumber(totalReturnPct, 2)}%`}
              </div>
            </div>
          </div>

          <div className="portfolio-capture-table-wrap">
            <table className="portfolio-capture-table">
              <thead>
                <tr>
                  <th>종목명</th>
                  <th>종목코드</th>
                  <th>매수가</th>
                  <th>매수일</th>
                  <th>손익</th>
                  <th>수익률</th>
                </tr>
              </thead>
              <tbody>
                {holdingAll.map((r: any) => {
                  const pnl = Number(r.unrealized_pnl || 0)
                  const pct = Number(r.unrealized_pct || 0)
                  return (
                    <tr key={`capture-${r.id}`}>
                      <td>{r.stock_name ?? r.ticker ?? r.symbol ?? '-'}</td>
                      <td>{r.code || '-'}</td>
                      <td>{formatKrw(Number(r.avg_price || 0))}</td>
                      <td>{r.buy_date || '-'}</td>
                      <td className={pnl < 0 ? 'negative' : pnl > 0 ? 'positive' : ''}>{formatSignedKrw(pnl)}</td>
                      <td className={pct < 0 ? 'negative' : pct > 0 ? 'positive' : ''}>{`${pct > 0 ? '+' : ''}${formatNumber(pct, 2)}%`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={maintModalOpen}
        title={
          maintMode === 'watchreset' ? '관심초기화' :
          maintMode === 'liquidateall' ? '전체매도' :
          maintMode === 'holdingrestore' ? '보유복구' :
          '보유수정'
        }
        onClose={() => setMaintModalOpen(false)}
        size="sm"
      >
        {maintMode === 'watchreset' && (
          <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
            관심 종목(보유수량 0)만 일괄 삭제합니다. 보유 종목은 유지됩니다.
          </div>
        )}

        {maintMode === 'liquidateall' && (
          <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
            현재 보유 종목을 기준가로 일괄 매도 처리합니다. 실행 후 보유수량이 0으로 전환됩니다.
          </div>
        )}

        {maintMode === 'holdingedit' && (
          <>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              {maintRow?.stock_name || maintCode || '종목'}의 매수가/수량을 재설정합니다.
            </div>
            <div className="grid-two" style={{ marginBottom: 'var(--space-3)' }}>
              <Input label="종목코드" value={maintCode} onChange={(e: any) => setMaintCode(String(e?.target?.value || '').toUpperCase())} />
              <Input label="수량" type="number" value={String(maintQty)} onChange={(e: any) => setMaintQty(Math.max(1, Number(e?.target?.value || 1)))} />
            </div>
            <Input
              label="매수가"
              type="number"
              value={maintBuyPrice === '' ? '' : String(maintBuyPrice)}
              onChange={(e: any) => setMaintBuyPrice(e?.target?.value === '' ? '' : Number(e?.target?.value))}
            />
          </>
        )}

        {maintMode === 'holdingrestore' && (
          <>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              누락된 보유 포지션을 복구합니다. 기존 포지션이 있으면 덮어쓰고, 없으면 새로 생성합니다.
            </div>
            <div className="grid-two" style={{ marginBottom: 'var(--space-3)' }}>
              <Input
                label="종목코드"
                placeholder="예) 005930"
                value={maintCode}
                onChange={(e: any) => setMaintCode(String(e?.target?.value || '').toUpperCase())}
              />
              <Input
                label="수량"
                type="number"
                value={String(maintQty)}
                onChange={(e: any) => setMaintQty(Math.max(1, Number(e?.target?.value || 1)))}
              />
            </div>
            <Input
              label="매수가 (원)"
              type="number"
              placeholder="예) 75000"
              value={maintBuyPrice === '' ? '' : String(maintBuyPrice)}
              onChange={(e: any) => setMaintBuyPrice(e?.target?.value === '' ? '' : Number(e?.target?.value))}
            />
            <div className="caption muted" style={{ marginTop: 'var(--space-2)' }}>
              거래 이력에 ADJUST 로그가 기록됩니다.
            </div>
          </>
        )}

        {maintError && (
          <div className="state-error" style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <div className="state-error-title">{maintError}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <Button variant="primary" onClick={runMaintenance} disabled={maintLoading}>
            {maintLoading ? '처리 중…' : '실행'}
          </Button>
          <Button variant="ghost" onClick={() => setMaintModalOpen(false)}>취소</Button>
        </div>
      </Modal>
    </section>
  )
}
