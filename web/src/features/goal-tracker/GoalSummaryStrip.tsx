import React from 'react'
import { ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { man, useGoalTracker } from './useGoalTracker'
import './goal-tracker.css'

/** 대시보드용 한 줄 요약 — 자세한 내용과 목표 설정은 '목표 트래커' 화면에서 본다 */
export default function GoalSummaryStrip() {
  const navigate = useNavigate()
  const { view } = useGoalTracker()
  if (!view) return null

  const gap = view.plan.gapPct
  const gapColor = gap >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)'

  return (
    <button type="button" className="goal-strip" onClick={() => navigate('/goal-tracker')} aria-label="목표 트래커 열기">
      <span className="goal-strip__title">목표</span>
      <span className="goal-strip__bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(0, view.target.progressPct))}%` }} />
      </span>
      <span className="goal-strip__text">
        {man(view.equity)} / {man(view.target.requiredSeed)} ({view.target.progressPct.toFixed(0)}%)
      </span>
      <span className="goal-strip__text" style={{ color: gapColor }}>
        계획 대비 {gap >= 0 ? '+' : ''}
        {gap.toFixed(1)}%
      </span>
      <span className="goal-strip__more">자세히 <ChevronRight size={12} aria-hidden /></span>
    </button>
  )
}
