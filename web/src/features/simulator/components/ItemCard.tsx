import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import GradeChip from './GradeChip'
import PositionStatusBadge from './PositionStatusBadge'
import RRBar from './RRBar'
import NumInput from './NumInput'
import type { calcPositionStatus } from '../telegramFormat'
import { clampPercent } from '../telegramFormat'
import type { HighlightPlanItem } from '../planStore'
import type { calcItemMeta } from '../lib/summary'
import { TP_SL_HORIZON_DAYS, empiricalWinProb, lookupTpSlBaseRate } from '../../../lib/tpSlBaseRates'

export type ItemCardProps = {
  row: HighlightPlanItem
  idx: number
  totalCapital: number
  meta: ReturnType<typeof calcItemMeta>[number]
  status: ReturnType<typeof calcPositionStatus>
  isOpen: boolean
  setExpandedIdx: React.Dispatch<React.SetStateAction<number | null>>
  updateItem: (idx: number, patch: Partial<HighlightPlanItem>) => void
  removeRow: (idx: number) => void
}

export default function ItemCard({
  row,
  idx,
  totalCapital,
  meta,
  status,
  isOpen,
  setExpandedIdx,
  updateItem,
  removeRow,
}: ItemCardProps) {
  const splitTotal = row.split1 + row.split2 + row.split3
  const splitOver = splitTotal > 100

  return (
        <div key={`${row.code || 'row'}-${idx}`} className={`sim-stock-card${isOpen ? ' sim-stock-card--open' : ''}`}>
          {/* 아코디언 헤더 */}
          <button
            className="sim-stock-header"
            onClick={() => setExpandedIdx(isOpen ? null : idx)}
            aria-expanded={isOpen}
          >
            <GradeChip grade={meta.grade} />
            <div className="sim-stock-info">
              <span className="sim-stock-name">{row.name || '(미입력)'}</span>
              <span className="sim-stock-code">{row.code || '—'}</span>
            </div>
            {status.status !== 'no_price' && (
              <PositionStatusBadge
                status={status.status}
                changePct={status.changePct}
              />
            )}
            <div className="sim-stock-metrics">
              <div className="sim-metric">
                <span className="sim-metric-label">배분</span>
                <span className="sim-metric-value">{formatKrw(row.amount)}</span>
              </div>
              <div className="sim-metric sim-metric--hide-sm">
                <span className="sim-metric-label">R:R</span>
                <span className="sim-metric-value">{formatNumber(meta.rr, 1)}:1</span>
              </div>
              <div className="sim-metric sim-metric--hide-sm">
                <span className="sim-metric-label">기대손익</span>
                <span className={`sim-metric-value${meta.ev >= 0 ? ' sim-pos' : ' sim-neg'}`}>
                  {meta.ev >= 0 ? '+' : ''}{formatKrw(meta.ev)}
                </span>
              </div>
            </div>
            <svg className={`sim-chevron${isOpen ? ' sim-chevron--open' : ''}`} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* 아코디언 바디 */}
          {isOpen && (
            <div className="sim-stock-body">
              {/* 종목 정보 */}
              <div className="sim-stock-id-row">
                <div className="sim-input-group">
                  <label className="sim-input-label">코드</label>
                  <input className="sim-input sim-input--mono" value={row.code}
                    onChange={(e) => updateItem(idx, { code: e.target.value })} placeholder="005930" />
                </div>
                <div className="sim-input-group sim-input-group--grow">
                  <label className="sim-input-label">종목명</label>
                  <input className="sim-input" value={row.name}
                    onChange={(e) => updateItem(idx, { name: e.target.value })} placeholder="삼성전자" />
                </div>
              </div>

              {/* 핵심 파라미터 */}
              <div className="sim-params-grid">
                <div className="sim-input-group">
                  <label className="sim-input-label">투입 금액</label>
                  <div className="sim-input-row">
                    <input className="sim-input" type="number" min={0} value={row.amount}
                      onChange={(e) => updateItem(idx, { amount: Math.max(0, Number(e.target.value || 0)) })} />
                    <span className="sim-input-suffix">원</span>
                  </div>
                </div>
                <div className="sim-input-group">
                  <label className="sim-input-label">목표 상승</label>
                  <div className="sim-input-row">
                    <input className="sim-input" type="number" value={row.targetPct}
                      onChange={(e) => updateItem(idx, { targetPct: Number(e.target.value || 0) })} />
                    <span className="sim-input-suffix">%</span>
                  </div>
                </div>
                <div className="sim-input-group">
                  <label className="sim-input-label">손절</label>
                  <div className="sim-input-row">
                    <input className="sim-input" type="number" min={0} value={row.stopPct}
                      onChange={(e) => updateItem(idx, { stopPct: Math.max(0, Number(e.target.value || 0)) })} />
                    <span className="sim-input-suffix">%</span>
                  </div>
                </div>
                <div className="sim-input-group">
                  <label className="sim-input-label">승률 가정</label>
                  <div className="sim-input-row">
                    <input className="sim-input" type="number" min={0} max={100} value={row.winProb}
                      onChange={(e) => updateItem(idx, { winProb: clampPercent(Number(e.target.value || 0), 0, 100) })} />
                    <span className="sim-input-suffix">%</span>
                  </div>
                  {(() => {
                    const rate = lookupTpSlBaseRate(row.targetPct, row.stopPct)
                    const fair = empiricalWinProb(row.targetPct, row.stopPct)
                    return (
                      <div className="caption" style={{ marginTop: 4, lineHeight: 1.5 }}>
                        과거 실측(목표+{rate.target}%/손절-{rate.stop}%, {TP_SL_HORIZON_DAYS}거래일): 목표 {rate.win}% · 손절 {rate.loss}% · 미결 {rate.none}% → 환산 승률 {fair}%
                        {row.winProb > fair + 5 && (
                          <button
                            type="button"
                            style={{ marginLeft: 6, background: 'none', border: 'none', padding: 0, color: 'var(--color-brand)', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => updateItem(idx, { winProb: fair })}
                          >
                            실측값으로
                          </button>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* 분할 진입 */}
              <div className="sim-split-section">
                <span className="sim-split-label">분할 비율</span>
                <div className="sim-split-grid">
                  <NumInput label="1차" value={row.split1} suffix="%" min={0} max={100}
                    onChange={(v) => updateItem(idx, { split1: clampPercent(v, 0, 100) })} />
                  <NumInput label="2차" value={row.split2} suffix="%" min={0} max={100}
                    onChange={(v) => updateItem(idx, { split2: clampPercent(v, 0, 100) })} />
                  <NumInput label="3차" value={row.split3} suffix="%" min={0} max={100}
                    onChange={(v) => updateItem(idx, { split3: clampPercent(v, 0, 100) })} />
                  <div className="sim-split-total">
                    <span className="sim-input-label">합계</span>
                    <span className={`sim-split-sum${splitOver ? ' sim-neg' : splitTotal === 100 ? ' sim-pos' : ''}`}>
                      {formatNumber(splitTotal, 0)}%
                    </span>
                    {splitOver && <span className="sim-split-warn">100% 초과</span>}
                  </div>
                </div>
              </div>

              {/* 파생 지표 */}
              <div className="sim-derived-row">
                <div className="sim-derived-item">
                  <span className="sim-derived-label">R:R 비율</span>
                  <RRBar rr={meta.rr} />
                </div>
                <div className="sim-derived-item">
                  <span className="sim-derived-label">켈리 추천 비율</span>
                  <span className="sim-derived-value">{formatNumber(meta.kelly, 1)}%</span>
                  <span className="sim-derived-hint">
                    ({formatKrw(totalCapital * meta.kelly / 100)})
                  </span>
                </div>
                <div className="sim-derived-item">
                  <span className="sim-derived-label">기대손익</span>
                  <span className={`sim-derived-value${meta.ev >= 0 ? ' sim-pos' : ' sim-neg'}`}>
                    {meta.ev >= 0 ? '+' : ''}{formatKrw(meta.ev)}
                  </span>
                </div>
                <div className="sim-derived-item">
                  <span className="sim-derived-label">체결 반영 투자금</span>
                  <span className="sim-derived-value">{formatKrw(meta.splitInvested)}</span>
                </div>
              </div>

              {/* 등급 안내 */}
              {meta.grade === 'D' && (
                <div className="sim-grade-warn">
                  이 거래는 기대값이 음수이거나 R:R이 불리합니다.
                  목표 상승률을 높이거나 손절을 좁히거나 승률을 재검토하세요.
                </div>
              )}
              {meta.grade === 'C' && meta.rr < 2 && (
                <div className="sim-grade-caution">
                  R:R이 2:1 미만입니다. 목표 대비 손절 비율 개선을 권장합니다.
                </div>
              )}

              <div className="sim-stock-footer">
                <button className="sim-btn sim-btn--danger" onClick={() => removeRow(idx)}>종목 제거</button>
              </div>
            </div>
          )}
        </div>
  )
}
