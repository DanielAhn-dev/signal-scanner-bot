import React from 'react'
import { formatKrw } from '../../../lib/format'
import type { calcSummary } from '../lib/summary'

export type SummaryCardProps = {
  totalCapital: number
  setTotalCapital: React.Dispatch<React.SetStateAction<number>>
  summary: ReturnType<typeof calcSummary>
}

export default function SummaryCard({
  totalCapital,
  setTotalCapital,
  summary,
}: SummaryCardProps) {
  return (
    <div className="sim-summary-card">
      <div className="sim-summary-grid">
        <div className="sim-summary-item">
          <label className="sim-summary-label" htmlFor="sim-total-capital">총 투자금 (원)</label>
          <input
            id="sim-total-capital"
            className="sim-input"
            type="number"
            min={0}
            inputMode="numeric"
            value={totalCapital}
            onChange={(e) => setTotalCapital(Math.max(0, Number(e.target.value || 0)))}
          />
        </div>
        <div className="sim-summary-item">
          <span className="sim-summary-label">배분 합계</span>
          <span className={`sim-summary-value${summary.remaining < 0 ? ' sim-neg' : ''}`}>{formatKrw(summary.allocated)}</span>
        </div>
        <div className="sim-summary-item">
          <span className="sim-summary-label">잔여 자금</span>
          <span className={`sim-summary-value${summary.remaining < 0 ? ' sim-neg' : ' sim-pos'}`}>
            {summary.remaining >= 0 ? '+' : ''}{formatKrw(summary.remaining)}
          </span>
        </div>
        <div className="sim-summary-item">
          <span className="sim-summary-label">최악일 때 손실</span>
          <span className="sim-summary-value sim-neg">{formatKrw(summary.maxLoss)}</span>
        </div>
      </div>
      <details className="sim-summary-more">
        <summary className="muted">자세히 (기대손익 · 체결 반영 투자금)</summary>
        <div className="sim-summary-grid" style={{ marginTop: 8 }}>
          <div className="sim-summary-item">
            <span className="sim-summary-label">기대손익 (월 목표 기준)</span>
            <span className={`sim-summary-value${summary.evAfterCost >= 0 ? ' sim-pos' : ' sim-neg'}`}>
              {summary.evAfterCost >= 0 ? '+' : ''}{formatKrw(summary.evAfterCost)}
            </span>
          </div>
          <div className="sim-summary-item">
            <span className="sim-summary-label">체결 반영 투자금</span>
            <span className="sim-summary-value">{formatKrw(summary.splitInvested)}</span>
          </div>
        </div>
      </details>
      {summary.remaining < 0 && (
        <div className="sim-warning-bar">
          배분 합계가 총 투자금을 {formatKrw(-summary.remaining)} 초과합니다.
        </div>
      )}
    </div>
  )
}
