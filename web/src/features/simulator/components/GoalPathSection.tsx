import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import Detail from '../../../components/ui/Detail'
import { calcWeeklyCyclePlan } from '../telegramFormat'
import type { HighlightPlanItem } from '../planStore'

export type GoalPathSectionProps = {
  items: HighlightPlanItem[]
  monthlyProfitTarget: number
  weeklyPlan: ReturnType<typeof calcWeeklyCyclePlan>
}

export default function GoalPathSection({
  items,
  monthlyProfitTarget,
  weeklyPlan,
}: GoalPathSectionProps) {
  return (
    <Detail>
    {items.filter(i => i.code !== 'CASH').length > 0 && monthlyProfitTarget > 0 && (
      <details className="sim-section collapsible">
        <summary className="collapsible__summary">
          <span className="sim-section-label">목표 달성 경로</span>
          <span className="muted collapsible__hint">고급 — 가정 기반 참고용</span>
        </summary>
        <p className="sim-section-desc">
          승률 가정 기반 · 주 1사이클(월~금) 기준 — 과거 10년 실측에서 주 단위 목표/손절 매매의 비용 차감 기대값은 목표·손절 조합과 무관하게 0% 안팎이었습니다.
        </p>
        <div className="sim-goal-plan">
          <div className="sim-goal-row">
            <span className="sim-goal-label">1사이클 기대수익</span>
            <span className={`sim-goal-value ${weeklyPlan.cycleEV >= 0 ? 'sim-pos' : 'sim-neg'}`}>
              {weeklyPlan.cycleEV >= 0 ? '+' : ''}{formatKrw(weeklyPlan.cycleEV)}
            </span>
          </div>
          <div className="sim-goal-row">
            <span className="sim-goal-label">1사이클 전량 목표 달성 시</span>
            <span className="sim-goal-value sim-pos">+{formatKrw(weeklyPlan.cycleMaxProfit)}</span>
          </div>
          <div className="sim-goal-row sim-goal-row--highlight">
            <span className="sim-goal-label">월 4사이클 기준 기대수익</span>
            <span className={`sim-goal-value ${weeklyPlan.monthlyEV >= 0 ? 'sim-pos' : 'sim-neg'}`}>
              {weeklyPlan.monthlyEV >= 0 ? '+' : ''}{formatKrw(weeklyPlan.monthlyEV)}
            </span>
          </div>
          <div className="sim-goal-row">
            <span className="sim-goal-label">월 목표</span>
            <span className="sim-goal-value">{formatKrw(monthlyProfitTarget)}</span>
          </div>
          {/* 달성률 프로그레스 바 */}
          <div className="sim-goal-progress-wrap">
            <div className="sim-goal-progress-track">
              <div
                className={`sim-goal-progress-fill ${weeklyPlan.progressPct >= 100 ? 'sim-goal-progress-fill--done' : weeklyPlan.progressPct >= 50 ? 'sim-goal-progress-fill--half' : 'sim-goal-progress-fill--low'}`}
                style={{ width: `${Math.min(100, weeklyPlan.progressPct)}%` }}
              />
            </div>
            <span className="sim-goal-progress-label">{formatNumber(weeklyPlan.progressPct, 1)}%</span>
          </div>
          {weeklyPlan.cycleEV > 0 ? (
            <>
              <div className="sim-goal-row">
                <span className="sim-goal-label">달성 예상</span>
                <span className="sim-goal-value">
                  {weeklyPlan.cyclesNeeded < 1000
                    ? `${weeklyPlan.weeksNeeded}주 ≈ ${formatNumber(weeklyPlan.weeksNeeded / 4, 1)}개월`
                    : '현재 조건으로 달성 불가'}
                </span>
              </div>
              {weeklyPlan.gapToTarget > 0 && (
                <div className="sim-goal-hint">
                  💡 목표까지 월 {formatKrw(weeklyPlan.gapToTarget)} 부족 —
                  투자금을 {formatNumber((monthlyProfitTarget / weeklyPlan.monthlyEV), 1)}배 늘리거나
                  종목 수익률/승률 개선 필요
                </div>
              )}
            </>
          ) : (
            <div className="sim-goal-hint sim-goal-hint--warn">
              ⚠️ 현재 포트폴리오의 기대수익이 0 이하입니다. 종목 파라미터를 점검하세요.
            </div>
          )}
          {/* 종목별 목표 기여 */}
          <div className="sim-goal-perstock">
            <span className="sim-goal-perstock-title">종목별 1사이클 기여 (목표 달성 시)</span>
            {weeklyPlan.perStock.map(s => (
              <div key={s.code} className="sim-goal-perstock-row">
                <span className="sim-goal-perstock-name">{s.name}<span className="sim-goal-perstock-code"> {s.code}</span></span>
                <span className="sim-goal-perstock-meta">목표 +{formatNumber(s.targetPct, 1)}% / 손절 -{formatNumber(s.stopPct, 1)}%</span>
                <span className="sim-goal-perstock-ev sim-pos">목표 달성 +{formatKrw(s.targetGainNet)}</span>
                <span className="sim-goal-perstock-ev sim-neg">손절 시 {formatKrw(s.stopLossNet)}</span>
                <span className={`sim-goal-perstock-ev ${s.ev >= 0 ? 'sim-pos' : 'sim-neg'}`}>기대 {s.ev >= 0 ? '+' : ''}{formatKrw(s.ev)}</span>
              </div>
            ))}
          </div>
        </div>
      </details>
    )}
    </Detail>
  )
}
