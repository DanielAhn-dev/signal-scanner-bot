import Button from '../../../components/ui/Button'
import Pagination from '../../../components/Pagination'
import Skeleton from '../../../components/Skeleton'
import { EmptyState } from '../../../components/StateViews'
import { formatNumber } from '../../../lib/format'
import { getEntryLevel } from '../lib/candidateScore'
import { AccumulationBadge, GradeBadge, WarnBadge } from './badges'
import type { ScanPanelState } from '../types'

export default function CandidateTable({ scan }: { scan: Pick<ScanPanelState, 'candidates' | 'total' | 'buycheckHighlightTopN' | 'loading' | 'error' | 'selectedSector' | 'conditionFilter' | 'page' | 'setPage' | 'pageSize' | 'isWatched' | 'isAdding' | 'isRemoving' | 'navigateToAnalyze' | 'navigateToExecutionGuide' | 'buycheckRiskGuard' | 'sortedCandidates' | 'totalPages' | 'displayRows' | 'onToggleWatchlist' | 'renderSortableHeader'> }) {
  const {
    candidates,
    total,
    buycheckHighlightTopN,
    loading,
    error,
    selectedSector,
    conditionFilter,
    page,
    setPage,
    pageSize,
    isWatched,
    isAdding,
    isRemoving,
    navigateToAnalyze,
    navigateToExecutionGuide,
    buycheckRiskGuard,
    sortedCandidates,
    totalPages,
    displayRows,
    onToggleWatchlist,
    renderSortableHeader,
  } = scan
  return (
    <>
      {/* 전체 목록 */}
      {loading && candidates.length === 0 ? (
        <div className="card"><Skeleton lines={6} height={16} /></div>
      ) : !error && sortedCandidates.length === 0 ? (
        <div className={conditionFilter === 'quick' ? 'scan-empty-viewport-center' : undefined}>
          <EmptyState title="스캔 결과 없음" description="스캔을 실행하거나 필터를 조정해 보세요." />
        </div>
      ) : (
        <div id="scan-candidates-section-capture" className="scan-candidates-section">
          {(conditionFilter !== 'all' || selectedSector !== 'all') && (
            <div className="scan-section-label scan-section-label--plain">
              {conditionFilter !== 'all'
                ? `필터 결과 · ${sortedCandidates.length}개`
                : `${selectedSector} 섹터 · ${sortedCandidates.length}개`}
              {conditionFilter === 'buycheck' && buycheckRiskGuard.overLimit && (
                <span style={{ marginLeft: 8, color: 'var(--color-error)', fontWeight: 700 }}>
                  자동 우선정렬 ON · 상위 {buycheckHighlightTopN}개 강조
                </span>
              )}
            </div>
          )}
          {conditionFilter === 'all' && selectedSector === 'all' && (
            <div className="scan-section-label scan-section-label--plain">
              TOP 카드 제외 잔여 후보 · {sortedCandidates.length}개 (실전 기준, 오늘 장중/종가 신호 반영)
            </div>
          )}
          <div className="scan-candidates-stage">
            <div className="scan-table-wrap xls-scroll-frame" style={{ ['--xls-table-min-width' as any]: '1280px' }}>
            <table className="xls-table scan-table scan-candidates-table" style={{ width: 'max(100%, 1280px)', tableLayout: 'auto', minWidth: 1280 }}>
              <thead>
                <tr className="xls-header-row">
                  <th className="xls-th">{renderSortableHeader('코드', 'code')}</th>
                  <th className="xls-th">{renderSortableHeader('종목명', 'name')}</th>
                  <th className="xls-th">{renderSortableHeader('섹터', 'sector_id')}</th>
                  <th className="xls-th">{renderSortableHeader('우선순위', 'priority_score')}</th>
                  <th className="xls-th">{renderSortableHeader('눌림점수', 'lead_accumulation_score')}</th>
                  <th className="xls-th">{renderSortableHeader('진입', 'entry_grade')}</th>
                  <th className="xls-th">{renderSortableHeader('진입점수', 'entry_score')}</th>
                  <th className="xls-th">{renderSortableHeader('추세', 'trend_grade')}</th>
                  <th className="xls-th">{renderSortableHeader('이격', 'dist_grade')}</th>
                  <th className="xls-th">{renderSortableHeader('저점근접', 'pivot_grade')}</th>
                  <th className="xls-th">{renderSortableHeader('경고', 'warn_score')}</th>
                  <th className="xls-th">{renderSortableHeader('유동성', 'liquidity')}</th>
                  <th className="xls-th">전략</th>
                  <th className="xls-th">신호경과</th>
                  <th className="xls-th">{renderSortableHeader('변동(%)', 'intraday_change_pct')}</th>
                  <th className="xls-th">{renderSortableHeader('기준일', 'trade_date')}</th>
                  <th className="xls-th">관리</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((s, idx) => {
                  const code = String(s.code)
                  const isAdded = isWatched(code)
                  const isAddingNow = isAdding(code)
                  const isRemovingNow = isRemoving(code)
                  const isMutating = isAddingNow || isRemovingNow
                  /* 진입 등급별 코드 셀 색상 */
                  const codeColor = getEntryLevel(s.entry_grade) === 'a'
                    ? 'var(--color-success)'
                    : getEntryLevel(s.entry_grade) === 'b'
                      ? 'var(--color-brand)'
                      : 'var(--color-text-secondary)'
                  return (
                    <tr
                      key={s.code}
                      className={`xls-row${idx % 2 === 1 ? ' xls-row--even' : ''}`}
                      onClick={() => navigateToAnalyze(code)}
                      style={{
                        cursor: 'pointer',
                        background: s.isExecutionPriority ? 'var(--color-brand-subtle)' : undefined,
                        outline: s.isExecutionPriority ? '1px solid var(--color-brand)' : undefined,
                        outlineOffset: s.isExecutionPriority ? '-1px' : undefined,
                      }}
                      title={`${s.name} 상세 분석`}
                    >
                      {/* 코드 */}
                      <td className="xls-cell" style={{ fontFamily: 'var(--font-family-mono)', fontSize: 11, color: codeColor, fontWeight: 600 }}>
                        {s.code}
                        {s.isExecutionPriority && (
                          <span
                            style={{
                              marginLeft: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              color: 'var(--color-brand)',
                            }}
                            title="보유 초과 구간의 집행 우선 후보"
                          >
                            #{s.executionPriorityRank}
                          </span>
                        )}
                      </td>
                      {/* 종목명 — 말줄임 */}
                      <td className="xls-cell" title={s.name} style={{ fontWeight: 500 }}>
                        {s.name}
                      </td>
                      {/* 섹터 — 말줄임 */}
                      <td className="xls-cell" title={s.sector_id ?? ''} style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        {s.sector_id ?? '—'}
                      </td>
                      {/* 우선순위 */}
                      <td className="xls-cell xls-cell--num" title="진입점수×20 − 경고점수×3 + 장중 현재가 보정">
                        <span className={s.priorityScore >= 60 ? 'scan-grade-badge scan-grade-a' : s.priorityScore >= 40 ? 'scan-grade-badge scan-grade-b' : 'scan-grade-label'}>
                          {formatNumber(s.priorityScore, 1)}
                        </span>
                      </td>
                      {/* 눌림점수 (이격·저점근접·추세·경고 등급 합산) */}
                      <td className="xls-cell xls-cell--num">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                          <span className={s.leadAccumulationScore >= 75 ? 'scan-grade-badge scan-grade-a' : s.leadAccumulationScore >= 55 ? 'scan-grade-badge scan-grade-b' : 'scan-grade-label'}>
                            {formatNumber(s.leadAccumulationScore, 0)}
                          </span>
                          {s.isAccumulationSignal && <AccumulationBadge stage={s.leadAccumulationStage} />}
                        </div>
                      </td>
                      {/* 진입 */}
                      <td className="xls-cell"><GradeBadge grade={s.entry_grade} /></td>
                      {/* 진입점수 */}
                      <td className="xls-cell xls-cell--num" style={{ fontSize: 11 }}>
                        {s.entry_score != null ? formatNumber(s.entry_score, 2) : '—'}
                      </td>
                      {/* 추세 */}
                      <td className="xls-cell"><GradeBadge grade={s.trend_grade} /></td>
                      {/* 매집 */}
                      <td className="xls-cell">
                        <GradeBadge grade={s.dist_grade} />
                        {s.dist_pct != null && (
                          <span className="scan-grade-label" style={{ fontSize: 10 }}> ({formatNumber(s.dist_pct, 1)}%)</span>
                        )}
                      </td>
                      {/* 세력선 */}
                      <td className="xls-cell">
                        <GradeBadge grade={s.pivot_grade} />
                        {s.vol_atr_grade && (
                          <span className="scan-grade-label" style={{ fontSize: 10 }}> /{s.vol_atr_grade}</span>
                        )}
                      </td>
                      {/* 경고 */}
                      <td className="xls-cell">
                        <WarnBadge grade={s.warn_grade} />
                      </td>
                      {/* 유동성 */}
                      <td className="xls-cell xls-cell--num" style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        {s.liquidity != null ? formatNumber(s.liquidity, 0) : '—'}
                      </td>
                      {/* 전략 */}
                      <td className="xls-cell" style={{ fontSize: 11 }}>
                        <span className={
                          s.strategyLabel === '데이'
                            ? 'scan-grade-badge scan-grade-a'
                            : s.strategyLabel === '오버나이트'
                              ? 'scan-grade-badge scan-grade-b'
                              : s.strategyLabel === '주간'
                                ? 'scan-grade-badge scan-grade-c'
                                : 'scan-grade-label'
                        }>
                          {s.strategyLabel}
                        </span>
                      </td>
                      {/* 신호경과 */}
                      <td className="xls-cell" style={{ fontSize: 11 }}>
                        {typeof s.quickLiteAgeDays === 'number'
                          ? (s.quickLiteAgeDays === 0 ? '당일' : `D-${s.quickLiteAgeDays}`)
                          : '—'}
                      </td>
                      {/* 변동(%) */}
                      <td className="xls-cell xls-cell--num">
                        {typeof s.intradayChangePct === 'number' ? (
                          <span style={{
                            color: s.intradayChangePct > 0 ? 'var(--color-stock-up)' : s.intradayChangePct < 0 ? 'var(--color-stock-down)' : undefined,
                            fontWeight: 600, fontSize: 11,
                          }}>
                            {s.intradayChangePct > 0 ? '+' : ''}{formatNumber(s.intradayChangePct, 2)}%
                          </span>
                        ) : '—'}
                      </td>
                      {/* 기준일 — 단일 행 말줄임 */}
                      <td className="xls-cell" style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        {s.tradeDateText}
                      </td>
                      {/* 관리 */}
                      <td className="xls-cell" onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                          <Button
                            variant="ghost"
                            onClick={() => navigateToExecutionGuide(code)}
                            title="실행 가이드 열기"
                            style={{ fontSize: 11, padding: '1px 6px' }}
                          >
                            가이드
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={(e: React.MouseEvent) => onToggleWatchlist(e, code)}
                            disabled={isMutating}
                            title={isAdded ? '관심 종목에서 제거' : '관심 종목에 추가'}
                            style={{ fontSize: 11, padding: '1px 6px' }}
                          >
                            {isAdded ? '⊖제거' : '⊕추가'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>

            {totalPages > 1 && (
              <div className="pagination-wrap">
                <Pagination page={page} pageSize={pageSize} total={sortedCandidates.length} onChange={setPage} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
