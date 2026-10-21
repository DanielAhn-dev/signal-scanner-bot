import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import { RefreshCw } from 'lucide-react'
import Detail from '../../../components/ui/Detail'
import ComparePanel from './ComparePanel'
import { calcRequiredAnnualReturn, calcAllocationWeight, calcExpectedValue, calcRR, type RecommendationStyle } from '../telegramFormat'
import type { HighlightPlanItem } from '../planStore'
import type { CompareResult, RecommendSource } from '../types'

export type RecommendSectionProps = {
  totalCapital: number
  items: HighlightPlanItem[]
  setItems: React.Dispatch<React.SetStateAction<HighlightPlanItem[]>>
  monthlyProfitTarget: number
  setMonthlyProfitTarget: React.Dispatch<React.SetStateAction<number>>
  feePct: number
  taxPct: number
  recommendedPortfolio: HighlightPlanItem[]
  showRecommendation: boolean
  setShowRecommendation: React.Dispatch<React.SetStateAction<boolean>>
  watchlistCandidates: HighlightPlanItem[]
  algoCandidates: HighlightPlanItem[]
  loadingAlgo: boolean
  loadingWatchlist: boolean
  loadingCandidates: boolean
  recommendSource: RecommendSource
  setRecommendSource: React.Dispatch<React.SetStateAction<RecommendSource>>
  recommendStyle: RecommendationStyle
  setRecommendStyle: React.Dispatch<React.SetStateAction<RecommendationStyle>>
  compareResult: CompareResult | null
  showCompare: boolean
  setShowCompare: React.Dispatch<React.SetStateAction<boolean>>
  setShowStockDetail: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedStockCode: React.Dispatch<React.SetStateAction<string>>
  setSelectedStockName: React.Dispatch<React.SetStateAction<string>>
  toast: { show: (message: string) => void }
  chatId: string
  generateRecommendation: () => void
  applyRecommendation: () => void
  generateCompare: () => void
  loadWatchlistCandidates: () => void | Promise<void>
  loadAlgoCandidates: () => void | Promise<void>
}

export default function RecommendSection({
  totalCapital,
  items,
  setItems,
  monthlyProfitTarget,
  setMonthlyProfitTarget,
  feePct,
  taxPct,
  recommendedPortfolio,
  showRecommendation,
  setShowRecommendation,
  watchlistCandidates,
  algoCandidates,
  loadingAlgo,
  loadingWatchlist,
  loadingCandidates,
  recommendSource,
  setRecommendSource,
  recommendStyle,
  setRecommendStyle,
  compareResult,
  showCompare,
  setShowCompare,
  setShowStockDetail,
  setSelectedStockCode,
  setSelectedStockName,
  toast,
  chatId,
  generateRecommendation,
  applyRecommendation,
  generateCompare,
  loadWatchlistCandidates,
  loadAlgoCandidates,
}: RecommendSectionProps) {
  return (
    <details className="sim-section sim-monthly-target-section collapsible">
      <summary className="collapsible__summary">
        <span className="sim-section-label">종목 추천받기</span>
        <span className="muted collapsible__hint">고르기 어려울 때만 — 월 목표 수익으로 후보와 배분을 제안합니다</span>
      </summary>
      {/* 추천 소스 선택 */}
      <div className="sim-rec-source-group">
        <button
          className={`sim-rec-source-btn${recommendSource === 'algo' ? ' sim-rec-source-btn--active' : ''}`}
          onClick={() => setRecommendSource('algo')}
        >
          <span className="sim-rec-source-label">알고리즘 추천</span>
          <span className="sim-rec-source-count">
            {loadingAlgo ? '...' : `${algoCandidates.length}개`}
          </span>
        </button>
        {chatId && (
          <button
            className={`sim-rec-source-btn${recommendSource === 'watchlist' ? ' sim-rec-source-btn--active' : ''}`}
            onClick={() => setRecommendSource('watchlist')}
          >
            <span className="sim-rec-source-label">관심종목</span>
            <span className="sim-rec-source-count">
              {loadingWatchlist ? '...' : `${watchlistCandidates.length}개`}
            </span>
          </button>
        )}
        <button
          className={`sim-rec-source-btn${recommendSource === 'items' ? ' sim-rec-source-btn--active' : ''}`}
          onClick={() => setRecommendSource('items')}
        >
          <span className="sim-rec-source-label">현재 종목</span>
          <span className="sim-rec-source-count">{items.filter(i => i.code !== 'CASH').length}개</span>
        </button>
        <button
          className="sim-btn sim-btn--ghost sim-btn--sm sim-rec-refresh-btn"
          onClick={() => { void loadAlgoCandidates(); if (chatId) void loadWatchlistCandidates() }}
          disabled={loadingCandidates}
          title="후보 새로고침"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="sim-rec-profile-group" role="group" aria-label="추천 성향">
        <button
          className={`sim-rec-profile-btn${recommendStyle === 'stable' ? ' sim-rec-profile-btn--active' : ''}`}
          onClick={() => setRecommendStyle('stable')}
          disabled={!showRecommendation}
        >
          안정
        </button>
        <button
          className={`sim-rec-profile-btn${recommendStyle === 'balanced' ? ' sim-rec-profile-btn--active' : ''}`}
          onClick={() => setRecommendStyle('balanced')}
          disabled={!showRecommendation}
        >
          균형
        </button>
        <button
          className={`sim-rec-profile-btn${recommendStyle === 'aggressive' ? ' sim-rec-profile-btn--active' : ''}`}
          onClick={() => setRecommendStyle('aggressive')}
          disabled={!showRecommendation}
        >
          공격
        </button>
      </div>

      <div className="sim-cash-reserve-info">
        <span>💰 현금 보유 추천:</span>
        <span className="sim-cash-reserve-value">{formatKrw(totalCapital * 0.2)} (20%)</span>
      </div>

      <div className="sim-monthly-target-wrap">
        <div className="sim-input-group">
          <label className="sim-input-label">원하는 월 수익</label>
          <div className="sim-input-row">
            <input 
              className="sim-input" 
              type="number" 
              min={0} 
              value={monthlyProfitTarget}
              onChange={(e) => setMonthlyProfitTarget(Math.max(0, Number(e.target.value || 0)))} 
            />
            <span className="sim-input-suffix">원</span>
          </div>
        </div>
        <div className="sim-monthly-calc">
          <div className="sim-monthly-item">
            <span className="sim-monthly-label">필요 연간 수익률</span>
            <span className="sim-monthly-value">
              {formatNumber(calcRequiredAnnualReturn(monthlyProfitTarget, totalCapital), 2)}%
            </span>
          </div>
          <div className="sim-monthly-item">
            <span className="sim-monthly-label">연간 목표 수익</span>
            <span className="sim-monthly-value">
              {formatKrw(monthlyProfitTarget * 12)}
            </span>
          </div>
        </div>
        {/* 계산은 맞지만 60% 같은 숫자를 그대로 보여 주면 달성 가능한 목표처럼 읽힌다 */}
        {calcRequiredAnnualReturn(monthlyProfitTarget, totalCapital) > 15 && (
          <p style={{ margin: '6px 0', fontSize: 12, color: 'var(--color-error)' }}>
            이 목표는 투자금에 비해 큽니다 — 검증된 규칙의 과거 수익은 연 10~13%입니다. 이 투자금이면 월{' '}
            {formatKrw(Math.round((totalCapital * 0.08) / 12))} 안팎이 현실적입니다(연 8% 가정). 필요한 시드는 홈의 목표 트래커에서 확인하세요.
          </p>
        )}
        <button
          className="sim-btn sim-btn--primary" 
          onClick={generateRecommendation}
          disabled={monthlyProfitTarget <= 0 || 
            (items.length === 0 && 
             ((chatId && watchlistCandidates.length === 0) ||
              (!chatId && algoCandidates.length === 0)))}
          title="Half-Kelly 방식으로 종목별 배분 비율을 계산합니다. 입력한 승률·손익비 가정에 따라 달라지는 참고값입니다."
        >
          추천 포트폴리오 만들기
        </button>
        {chatId && algoCandidates.length > 0 && watchlistCandidates.length > 0 && (
          <button
            className="sim-btn sim-btn--ghost"
            onClick={generateCompare}
            disabled={monthlyProfitTarget <= 0 || loadingCandidates}
            title="알고리즘 추천 vs 관심종목 추천 비교"
          >
            포트폴리오 비교
          </button>
        )}
      </div>

      {/* 비교 패널 */}
      {showCompare && compareResult && (
        <ComparePanel
          algoPortfolio={compareResult.algo}
          watchlistPortfolio={compareResult.watchlist}
          totalCapital={totalCapital}
          monthlyTarget={monthlyProfitTarget}
          feePct={feePct}
          taxPct={taxPct}
          onClose={() => setShowCompare(false)}
          onApplyAlgo={() => {
            setItems(compareResult.algo)
            setShowCompare(false)
            toast.show('알고리즘 추천 포트폴리오를 적용했습니다.')
          }}
          onApplyWatchlist={() => {
            setItems(compareResult.watchlist)
            setShowCompare(false)
            toast.show('관심종목 추천 포트폴리오를 적용했습니다.')
          }}
        />
      )}

      {/* 추천 결과 표시 */}
      {showRecommendation && recommendedPortfolio.length > 0 && (
        <div className="sim-recommendation-panel">
          <div className="sim-rec-header">
            <h3 className="sim-rec-title">🎯 추천 포트폴리오</h3>
            <button className="sim-btn sim-btn--ghost" onClick={() => setShowRecommendation(false)}>닫기</button>
          </div>
<Detail>            <p className="sim-rec-desc">
            월 {formatKrw(monthlyProfitTarget)} 목표 달성을 위해 Kelly Criterion 기반으로 선정된 포트폴리오입니다.
            각 종목의 기대값과 위험도를 고려해 배분되었습니다.
          </p></Detail>
          <div className="sim-rec-list">
            {recommendedPortfolio.map((rec, idx) => {
              const weights = recommendedPortfolio.reduce((acc, r) => acc + calcAllocationWeight(r, recommendStyle), 0)
              const allocPct = weights > 0 ? (calcAllocationWeight(rec, recommendStyle) / weights) * 100 : 0
              const rr = calcRR(rec)
              const ev = calcExpectedValue(rec)
              return (
                <div key={`${rec.code}-${idx}`} className="sim-rec-item">
                  <div className="sim-rec-item-name">
                    <span className="sim-rec-code">{rec.code}</span>
                    <span className="sim-rec-name">{rec.name}</span>
                    <button
                      className="sim-btn sim-btn--xs sim-btn--ghost"
                      onClick={() => {
                        setSelectedStockCode(rec.code)
                        setSelectedStockName(rec.name)
                        setShowStockDetail(true)
                      }}
                    >
                      시세
                    </button>
                  </div>
                  <div className="sim-rec-metrics">
                    <div className="sim-rec-metric">
                      <span className="sim-rec-label">배분액</span>
                      <span className="sim-rec-value">{formatKrw(rec.amount)}</span>
                    </div>
                    <div className="sim-rec-metric">
                      <span className="sim-rec-label">비중</span>
                      <span className="sim-rec-value">{formatNumber(allocPct, 1)}%</span>
                    </div>
                    <Detail>
                    <div className="sim-rec-metric">
                      <span className="sim-rec-label">R:R</span>
                      <span className="sim-rec-value">{formatNumber(rr, 1)}:1</span>
                    </div>
                    <div className="sim-rec-metric">
                      <span className={`sim-rec-value${ev >= 0 ? ' sim-pos' : ' sim-neg'}`}>
                        {ev >= 0 ? '+' : ''}{formatKrw(ev)}
                      </span>
                    </div>
                    </Detail>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="sim-rec-footer">
            <button className="sim-btn sim-btn--ghost" onClick={() => setShowRecommendation(false)}>취소</button>
            <button className="sim-btn sim-btn--primary" onClick={applyRecommendation}>이 포트폴리오 적용</button>
          </div>
        </div>
      )}
    </details>
  )
}
