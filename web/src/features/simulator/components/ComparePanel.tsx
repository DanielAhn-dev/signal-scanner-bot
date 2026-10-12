import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import type { HighlightPlanItem } from '../planStore'
import { calcExpectedValue, calcRR, calcWeeklyCyclePlan } from '../telegramFormat'

export default function ComparePanel({
  algoPortfolio,
  watchlistPortfolio,
  totalCapital,
  monthlyTarget,
  feePct,
  taxPct,
  onClose,
  onApplyAlgo,
  onApplyWatchlist,
}: {
  algoPortfolio: HighlightPlanItem[]
  watchlistPortfolio: HighlightPlanItem[]
  totalCapital: number
  monthlyTarget: number
  feePct: number
  taxPct: number
  onClose: () => void
  onApplyAlgo: () => void
  onApplyWatchlist: () => void
}) {
  const CYCLES = 4

  function colSummary(portfolio: HighlightPlanItem[]) {
    const tradeable = portfolio.filter(i => i.code !== 'CASH')
    const totalEV = tradeable.reduce((acc, i) => acc + calcExpectedValue(i), 0)
    const plan = calcWeeklyCyclePlan(tradeable, monthlyTarget, feePct, taxPct)
    const maxProfit = plan.cycleMaxProfit
    const cycleEV = plan.cycleEV
    const monthlyEV = cycleEV * CYCLES
    const weeksNeeded = cycleEV > 0 ? Math.ceil(monthlyTarget / cycleEV) : Infinity
    return { totalEV, maxProfit, cycleEV, monthlyEV, weeksNeeded }
  }

  const algoSummary = colSummary(algoPortfolio)
  const watchSummary = colSummary(watchlistPortfolio)

  // 어느 쪽이 더 유리한지 표시용
  const algoWins = algoSummary.monthlyEV >= watchSummary.monthlyEV

  function PortfolioCol({
    label,
    portfolio,
    summary,
    onApply,
    highlight,
  }: {
    label: string
    portfolio: HighlightPlanItem[]
    summary: ReturnType<typeof colSummary>
    onApply: () => void
    highlight: boolean
  }) {
    const tradeable = portfolio.filter(i => i.code !== 'CASH')
    return (
      <div className={`sim-compare-col${highlight ? ' sim-compare-col--winner' : ''}`}>
        <div className="sim-compare-col-head">
          <span className="sim-compare-col-title">{label}</span>
          {highlight && <span className="sim-compare-winner-badge">더 유리</span>}
          <span className="sim-compare-col-count">{tradeable.length}개 종목</span>
        </div>

        {tradeable.length === 0 ? (
          <div className="sim-compare-empty">추천 종목 없음 (품질 기준 미충족)</div>
        ) : (
          <div className="sim-compare-stock-list">
            {tradeable.map((item, idx) => {
              const ev = calcExpectedValue(item)
              const rr = calcRR(item)
              return (
                <div key={`${item.code}-${idx}`} className="sim-compare-stock-row">
                  <div className="sim-compare-stock-info">
                    <span className="sim-compare-stock-name">{item.name}</span>
                    <span className="sim-compare-stock-code">{item.code}</span>
                  </div>
                  <div className="sim-compare-stock-metrics">
                    <span className="sim-compare-metric">{formatKrw(item.amount)}</span>
                    <span className="sim-compare-metric sim-compare-metric--rr">R:R {formatNumber(rr, 1)}:1</span>
                    <span className={`sim-compare-metric ${ev >= 0 ? 'sim-pos' : 'sim-neg'}`}>
                      {ev >= 0 ? '+' : ''}{formatKrw(ev)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="sim-compare-summary">
          <div className="sim-compare-summary-row">
            <span className="sim-compare-summary-label">1사이클 기대수익</span>
            <span className={`sim-compare-summary-value ${summary.cycleEV >= 0 ? 'sim-pos' : 'sim-neg'}`}>
              {summary.cycleEV >= 0 ? '+' : ''}{formatKrw(summary.cycleEV)}
            </span>
          </div>
          <div className="sim-compare-summary-row">
            <span className="sim-compare-summary-label">전량 목표 달성 시</span>
            <span className="sim-compare-summary-value sim-pos">+{formatKrw(summary.maxProfit)}</span>
          </div>
          <div className="sim-compare-summary-row sim-compare-summary-row--highlight">
            <span className="sim-compare-summary-label">월 기대수익 (×4)</span>
            <span className={`sim-compare-summary-value ${summary.monthlyEV >= 0 ? 'sim-pos' : 'sim-neg'}`}>
              {summary.monthlyEV >= 0 ? '+' : ''}{formatKrw(summary.monthlyEV)}
            </span>
          </div>
          <div className="sim-compare-summary-row">
            <span className="sim-compare-summary-label">목표 달성 예상</span>
            <span className="sim-compare-summary-value">
              {summary.weeksNeeded < 1000
                ? `${summary.weeksNeeded}주 ≈ ${formatNumber(summary.weeksNeeded / 4, 1)}개월`
                : '달성 어려움'}
            </span>
          </div>
        </div>

        <button
          className={`sim-btn ${highlight ? 'sim-btn--primary' : 'sim-btn--ghost'} sim-compare-apply-btn`}
          onClick={onApply}
          disabled={tradeable.length === 0}
        >
          {label}으로 적용
        </button>
      </div>
    )
  }

  return (
    <div className="sim-compare-panel">
      <div className="sim-compare-header">
        <h3 className="sim-compare-title">📊 포트폴리오 비교</h3>
        <button className="sim-btn sim-btn--ghost" onClick={onClose}>닫기</button>
      </div>
      <p className="sim-compare-desc">
        동일 투자금 {formatKrw(totalCapital)} 기준 · 월 목표 {formatKrw(monthlyTarget)} · 주 1사이클 기준
      </p>
      <div className="sim-compare-grid">
        <PortfolioCol
          label="알고리즘 추천"
          portfolio={algoPortfolio}
          summary={algoSummary}
          onApply={onApplyAlgo}
          highlight={algoWins}
        />
        <PortfolioCol
          label="관심종목 추천"
          portfolio={watchlistPortfolio}
          summary={watchSummary}
          onApply={onApplyWatchlist}
          highlight={!algoWins}
        />
      </div>
    </div>
  )
}
