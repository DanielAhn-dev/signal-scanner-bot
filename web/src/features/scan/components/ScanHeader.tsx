import Button from '../../../components/ui/Button'
import EconomicEventBadge from '../../../components/EconomicEventBadge'
import SheetHeaderBar from '../../../components/SheetHeaderBar'
import { formatNumber } from '../../../lib/format'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { BASIC_CONDITION_FILTER_KEYS, PRIMARY_MODE_OPTIONS } from '../constants'
import { ConfirmTrendSparkline } from './Sparklines'
import type { ScanPanelState } from '../types'

export default function ScanHeader({ scan }: { scan: Pick<ScanPanelState, 'onNavigate' | 'candidates' | 'latestDate' | 'marketPhase' | 'realtimeAppliedCount' | 'buycheckMaxHoldings' | 'setBuycheckMaxHoldings' | 'buycheckHighlightTopN' | 'setBuycheckHighlightTopN' | 'error' | 'selectedSector' | 'setSelectedSector' | 'conditionFilter' | 'showAdvancedFilters' | 'setShowAdvancedFilters' | 'filterChipScrollRef' | 'advancedConditionOptions' | 'handleFilterChipWheel' | 'handleFilterChipKeyDown' | 'sectors' | 'filterCounts' | 'confirmPromotionMeta' | 'buycheckRiskGuard' | 'sortedCandidates' | 'handleConditionFilter'> }) {
  const {
    onNavigate,
    candidates,
    latestDate,
    marketPhase,
    realtimeAppliedCount,
    buycheckMaxHoldings,
    setBuycheckMaxHoldings,
    buycheckHighlightTopN,
    setBuycheckHighlightTopN,
    error,
    selectedSector,
    setSelectedSector,
    conditionFilter,
    showAdvancedFilters,
    setShowAdvancedFilters,
    filterChipScrollRef,
    advancedConditionOptions,
    handleFilterChipWheel,
    handleFilterChipKeyDown,
    sectors,
    filterCounts,
    confirmPromotionMeta,
    buycheckRiskGuard,
    sortedCandidates,
    handleConditionFilter,
  } = scan
  return (
    <>
      {/* ── 헤더 테이블 (제목·필터·섹터) — 4열, B2 안전 여백 내 ── */}
      <div className="xls-scroll-frame" style={{ ['--xls-table-min-width' as any]: '360px' }}>
      <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '30%' }} />
          <col style={{ width: '30%' }} />
          <col style={{ width: '20%' }} />
        </colgroup>
        <tbody>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
              <SheetHeaderBar
                title="눌림목(스윙/중기)"
                action={<EconomicEventBadge onNavigateToCalendar={() => onNavigate?.('economy')} />}
              />
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell xls-cell--wrap" colSpan={4}
              style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>
              <span className="scan-stat-count">{sortedCandidates.length}</span>개 후보 ·
              최신 기준일 {latestDate ?? '—'} · {marketPhase === 'intraday' ? `장중 현재가 반영(${realtimeAppliedCount}건)` : '종가 기준'} · 텔레그램 pullback 신호 기반 · 종목 클릭 시 상세 분석으로 이동
              {conditionFilter === 'confirm' && (
                <span
                  style={{
                    marginLeft: 8,
                    padding: '1px 6px',
                    borderRadius: 999,
                    border: '1px solid var(--color-brand)',
                    color: 'var(--color-brand)',
                    fontWeight: 700,
                    background: 'var(--color-brand-subtle)',
                  }}
                  title={[
                    `후보 ${formatNumber(confirmPromotionMeta.base, 0)}개 중 확인 ${formatNumber(confirmPromotionMeta.promoted, 0)}개`,
                    confirmPromotionMeta.latest5AvgRatioPct != null
                      ? `최근 ${Math.max(1, confirmPromotionMeta.trendSampleDays)}일 평균 ${formatNumber(confirmPromotionMeta.latest5AvgRatioPct, 1)}%`
                      : '최근 5일 평균 데이터 없음',
                  ].join(' · ')}
                >
                  후보→확인 승격 {confirmPromotionMeta.ratioPct}%
                  {' · '}
                  최근5일 평균 {confirmPromotionMeta.latest5AvgRatioPct != null ? `${formatNumber(confirmPromotionMeta.latest5AvgRatioPct, 1)}%` : '—'}
                  <ConfirmTrendSparkline values={confirmPromotionMeta.recentRatios} />
                  {confirmPromotionMeta.trendDeltaPct != null && (
                    <>
                      {' '}
                      ({confirmPromotionMeta.trendDeltaPct > 0 ? <TrendingUp size={12} aria-hidden /> : confirmPromotionMeta.trendDeltaPct < 0 ? <TrendingDown size={12} aria-hidden /> : <Minus size={12} aria-hidden />}
                      {' '}
                      {confirmPromotionMeta.trendDeltaPct > 0 ? '+' : ''}{formatNumber(confirmPromotionMeta.trendDeltaPct, 1)}%p)
                    </>
                  )}
                </span>
              )}
            </td>
          </tr>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={4} style={{ padding: '3px 6px', overflow: 'visible' }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
                  {PRIMARY_MODE_OPTIONS.map((option) => (
                    <Button
                      key={option.key}
                      variant={conditionFilter === option.key ? 'primary' : 'secondary'}
                      size="lg"
                      onClick={() => handleConditionFilter(option.key)}
                      title={`${option.label} 모드`}
                      style={{ width: '100%' }}
                    >
                      {option.label} ({filterCounts[option.key]})
                    </Button>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      type="button"
                      className={`tag${conditionFilter === 'all' ? ' active' : ''}`}
                      onClick={() => handleConditionFilter('all')}
                    >
                      전체 ({filterCounts.all})
                    </button>
                    <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                      기본은 후보·확인·매수검토만 표시됩니다.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="tag"
                    style={{ fontSize: 10, padding: '1px 8px' }}
                    onClick={() => setShowAdvancedFilters((prev) => !prev)}
                  >
                    {showAdvancedFilters ? '고급 필터 접기' : '고급 필터 펼치기'}
                  </button>
                </div>

                <div
                  className="scan-cond-chips"
                  ref={filterChipScrollRef}
                  role="tablist"
                  aria-label="스캔 고급 필터"
                  onWheel={handleFilterChipWheel}
                  onKeyDown={handleFilterChipKeyDown}
                  style={{
                    display:
                      showAdvancedFilters ||
                      (conditionFilter !== 'all' && !BASIC_CONDITION_FILTER_KEYS.has(conditionFilter))
                        ? 'flex'
                        : 'none',
                  }}
                >
                  {advancedConditionOptions.map((option) => (
                    <button
                      key={option.key}
                      data-filter-chip="1"
                      className={`tag${conditionFilter === option.key ? ' active' : ''}`}
                      id={`scan-filter-tab-${option.key}`}
                      role="tab"
                      aria-selected={conditionFilter === option.key}
                      aria-controls="scan-candidates-section-capture"
                      tabIndex={conditionFilter === option.key ? 0 : -1}
                      onClick={() => handleConditionFilter(option.key)}
                    >
                      {option.label} ({filterCounts[option.key]})
                    </button>
                  ))}
                </div>
              </div>
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" style={{ fontWeight: 600, fontSize: 11, color: 'var(--color-text-secondary)' }}>
              섹터 필터
            </td>
            <td className="xls-cell" colSpan={3} style={{ padding: '2px 6px' }}>
              <select
                className="input scan-sector-select"
                value={selectedSector}
                onChange={(e) => setSelectedSector(e.target.value)}
                style={{ width: '100%', height: 18, fontSize: 11, padding: '0 4px', border: '1px solid var(--color-excel-grid-border)', background: 'var(--color-gray-0)' }}
              >
                {sectors.map((sector) => (
                  <option key={sector} value={sector}>{sector === 'all' ? '전체 섹터' : sector}</option>
                ))}
              </select>
            </td>
          </tr>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={4} style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              권장 사용: 후보(먼저 찾기) → 확인(전환 체크) → 매수검토(집행 후보)
            </td>
          </tr>
          {conditionFilter === 'buycheck' && (
            <tr className="xls-row">
              <td
                className="xls-cell"
                colSpan={4}
                style={{
                  fontSize: 11,
                  color: buycheckRiskGuard.overLimit ? 'var(--color-error)' : 'var(--color-warning)',
                  fontWeight: 700,
                  background: buycheckRiskGuard.overLimit ? 'var(--color-error-bg)' : 'transparent',
                }}
              >
                {buycheckRiskGuard.label}
              </td>
            </tr>
          )}
          {conditionFilter === 'buycheck' && (
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" colSpan={4} style={{ fontSize: 11, padding: '4px 6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>최대 보유 기준</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={30}
                      value={buycheckMaxHoldings}
                      onChange={(e) => setBuycheckMaxHoldings(Math.max(1, Math.min(30, Number(e.target.value || 8))))}
                      style={{ width: 74, height: 22, fontSize: 11, padding: '0 6px' }}
                    />
                    <span style={{ color: 'var(--color-text-tertiary)' }}>종목</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>초과 시 강조 TOP</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={15}
                      value={buycheckHighlightTopN}
                      onChange={(e) => setBuycheckHighlightTopN(Math.max(1, Math.min(15, Number(e.target.value || 5))))}
                      style={{ width: 66, height: 22, fontSize: 11, padding: '0 6px' }}
                    />
                  </label>
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>
                    보유 초과 시 매수검토는 우선순위 기준 자동 정렬됩니다.
                  </span>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </>
  )
}
