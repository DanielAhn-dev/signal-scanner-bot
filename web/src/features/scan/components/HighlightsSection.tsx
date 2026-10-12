import React from 'react'
import Button from '../../../components/ui/Button'
import { formatNumber } from '../../../lib/format'
import { AccumulationBadge, GradeBadge, SignalBadge, WarnBadge } from './badges'
import type { ScanPanelState } from '../types'

export default function HighlightsSection({ scan }: { scan: Pick<ScanPanelState, 'onNavigate' | 'loading' | 'error' | 'selectedSector' | 'conditionFilter' | 'isMobileViewport' | 'navigateToAnalyze' | 'activeHighlights' | 'highlightOverlapSet'> }) {
  const {
    onNavigate,
    loading,
    error,
    selectedSector,
    conditionFilter,
    isMobileViewport,
    navigateToAnalyze,
    activeHighlights,
    highlightOverlapSet,
  } = scan
  return (
    <>
      {/* 참고용 추천 섹션 */}
      {!loading && !error && activeHighlights.length > 0 && conditionFilter === 'all' && selectedSector === 'all' && (
        <div className="scan-highlights-section" id="scan-highlight-section-capture">
        {isMobileViewport ? (
          <>
            <div className="scan-highlight-section-head">
              <div className="scan-highlight-section-copy">
                <div className="scan-highlight-section-title">눌림목 집행 TOP 카드</div>
                <div className="scan-highlight-section-subtitle">스윙/중기 기준 · 하단 잔여 후보와 분리</div>
              </div>
              {onNavigate && (
                <Button variant="secondary" onClick={() => onNavigate('highlights')}>
                  집행우선 허브
                </Button>
              )}
            </div>
            <div className="scan-highlight-mobile-list">
              {activeHighlights.map((c, idx) => {
                const rank = idx + 1
                const isTop1 = rank === 1
                return (
                  <button
                    key={c.code}
                    type="button"
                    className={`scan-highlight-mobile-card${isTop1 ? ' scan-highlight-mobile-card--top' : ''}`}
                    onClick={() => navigateToAnalyze(c.code)}
                    title={`${c.name} 참고용 상세 보기`}
                  >
                    <div className="scan-highlight-mobile-card__head">
                      <span className="scan-highlight-mobile-card__rank">TOP {rank}</span>
                      <WarnBadge grade={c.warn_grade} />
                    </div>
                    <div className="scan-highlight-mobile-card__name">{c.name}</div>
                    <div className="scan-highlight-mobile-card__code">
                      {c.code}
                      <span className="scan-highlight-mobile-card__source">
                        {highlightOverlapSet.has(c.code) ? '하이라이트 공통' : '스캔 전용'}
                      </span>
                    </div>
                    <div className="scan-highlight-mobile-card__grades">
                      <GradeBadge grade={c.entry_grade} label="진입" />
                      <GradeBadge grade={c.trend_grade} label="추세" />
                      <GradeBadge grade={c.dist_grade} label="이격" />
                      {c.pivot_grade && <GradeBadge grade={c.pivot_grade} label="저점" />}
                      {c.signal && <SignalBadge signal={c.signal} />}
                    </div>
                    <div className="scan-highlight-mobile-card__meta">
                      {[
                        c.sector_id,
                        c.entry_score != null ? `진입 ${formatNumber(c.entry_score, 1)}` : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                    <div className="scan-highlight-mobile-card__cta">눌림목 상세 분석 →</div>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
        <table className="xls-table scan-highlight-table" style={{ width: '100%', tableLayout: 'fixed' }}>
          <colgroup>
            {Array.from({ length: 26 }, (_, i) => <col key={i} />)}
          </colgroup>
          <tbody>
            {/* 추천 섹션 제목 행 */}
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" colSpan={20}
                style={{ fontWeight: 700, fontSize: 12, color: 'var(--color-brand)' }}>
                눌림목 집행 TOP 카드
                <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--color-text-tertiary)', marginLeft: 8 }}>
                  스윙/중기 기준 · 하단 잔여 후보와 분리
                </span>
              </td>
              <td className="xls-cell" colSpan={6} style={{ textAlign: 'right', padding: '1px 4px' }}>
                {onNavigate && (
                  <Button variant="secondary" onClick={() => onNavigate('highlights')}>
                    집행우선 허브
                  </Button>
                )}
              </td>
            </tr>
            {/* ── 추천 카드 ──
                각 카드 = colSpan(열 분할) × rowSpan(9행 × 22px = 198px)
                내용은 자연스럽게 위→아래 배치, height:100% 사용 안 함
            ── */}
            {(isMobileViewport ? activeHighlights.map((_, i) => i) : [0, 3]).map((startIdx) => {
              const rowCards = isMobileViewport
                ? activeHighlights.slice(startIdx, startIdx + 1)
                : activeHighlights.slice(startIdx, startIdx + 3)
              if (rowCards.length === 0) return null
              const count = rowCards.length
              const CARD_ROWS = isMobileViewport ? 7 : 9
              /* 열 균등 분배: 26열을 카드 수로 나눔 */
              const colsPerCard = Math.floor(26 / count)
              return (
                <React.Fragment key={`card-row-${startIdx}`}>
                  <tr>
                    {rowCards.map((c, i) => {
                      const rank = startIdx + i + 1
                      const isTop1 = rank === 1
                      const colSpan = i === count - 1 ? 26 - colsPerCard * i : colsPerCard
                      return (
                        <td
                          key={c.code}
                          className={`xls-cell scan-highlight-card-cell${isTop1 ? ' scan-highlight-card-cell--top' : ''}`}
                          colSpan={colSpan}
                          rowSpan={CARD_ROWS}
                          onClick={() => navigateToAnalyze(c.code)}
                          title={`${c.name} 참고용 상세 보기`}
                          style={{
                            verticalAlign: 'top',
                            cursor: 'pointer',
                            padding: '12px 14px',
                          }}
                        >
                          {/* ① 랭크 + 경고 뱃지 */}
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 6,
                          }}>
                            <span style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: isTop1 ? 'var(--color-brand)' : 'var(--color-text-tertiary)',
                              letterSpacing: '0.05em',
                            }}>
                              TOP {rank}
                            </span>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <AccumulationBadge stage={c.leadAccumulationStage === 'none' ? null : c.leadAccumulationStage} />
                              <WarnBadge grade={c.warn_grade} />
                            </div>
                          </div>

                          {/* ② 종목명 */}
                          <div style={{
                            fontWeight: 700,
                            fontSize: 15,
                            color: 'var(--color-text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginBottom: 2,
                          }}>
                            {c.name}
                          </div>

                          {/* ③ 종목코드 */}
                          <div style={{
                            fontSize: 11,
                            color: 'var(--color-text-tertiary)',
                            fontFamily: 'var(--font-family-mono)',
                            marginBottom: 10,
                          }}>
                            {c.code}
                            <span style={{ marginLeft: 8, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family-base)' }}>
                              {highlightOverlapSet.has(c.code) ? '하이라이트 공통' : '스캔 전용'}
                            </span>
                          </div>

                          {/* ④ 등급 뱃지 */}
                          <div style={{
                            display: 'flex',
                            gap: 5,
                            flexWrap: 'wrap',
                            marginBottom: 8,
                          }}>
                            <GradeBadge grade={c.entry_grade} label="진입" />
                            <GradeBadge grade={c.trend_grade} label="추세" />
                            <GradeBadge grade={c.dist_grade} label="이격" />
                            {c.pivot_grade && <GradeBadge grade={c.pivot_grade} label="저점" />}
                            <AccumulationBadge stage={c.leadAccumulationStage === 'none' ? null : c.leadAccumulationStage} />
                            {c.signal && <SignalBadge signal={c.signal} />}
                          </div>

                          {/* ⑤ 섹터 · 진입점수 */}
                          <div style={{
                            fontSize: 11,
                            color: 'var(--color-text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginBottom: 10,
                          }}>
                            {[
                              c.sector_id,
                              c.entry_score != null ? `진입 ${formatNumber(c.entry_score, 1)}` : null,
                            ].filter(Boolean).join(' · ')}
                          </div>

                          {/* ⑥ 상세 링크 힌트 */}
                          <div style={{
                            fontSize: 11,
                            color: 'var(--color-brand)',
                            fontWeight: 500,
                          }}>
                            눌림목 상세 분석 →
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                  {/* rowSpan 채우는 더미 행 */}
                  {Array.from({ length: CARD_ROWS - 1 }, (_, ri) => (
                    <tr key={`spacer-${startIdx}-${ri}`} style={{ height: 22 }} />
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
        )}
        </div>
      )}
    </>
  )
}
