import React, { useEffect, useState } from 'react'
import { STEPS, STEP_THRESHOLDS, TOTAL_SECONDS } from '../constants'

export default function BacktestSkeleton() {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const progressPct = Math.min(92, (elapsed / TOTAL_SECONDS) * 100)
  let completedStep = -1
  for (let i = 0; i < STEP_THRESHOLDS.length; i++) {
    if (elapsed >= STEP_THRESHOLDS[i]) completedStep = i
  }
  const activeStep = completedStep + 1 < STEPS.length ? completedStep + 1 : STEPS.length - 1

  return (
    <div className="bt-skeleton">
      <div>
        <div className="bt-skeleton-progress-header">
          <span className="bt-skeleton-step-label">{STEPS[activeStep]}...</span>
          <span className="bt-skeleton-elapsed">{elapsed}초 경과</span>
        </div>
        <div className="bt-skeleton-track">
          <div className="bt-skeleton-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="bt-skeleton-step-names">
          {STEPS.map((s, i) => (
            <span
              key={i}
              className={
                'bt-skeleton-step-name' +
                (i <= completedStep
                  ? ' bt-skeleton-step-name--done'
                  : i === activeStep
                  ? ' bt-skeleton-step-name--active'
                  : '')
              }
            >
              {s}
            </span>
          ))}
        </div>
      </div>
      <hr className="bt-skeleton-divider" />
      <div className="bt-skeleton-summary-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bt-skeleton-summary-item">
            <div className="skeleton" style={{ height: 10, width: '55%' }} />
            <div className="skeleton" style={{ height: 22, width: '70%' }} />
          </div>
        ))}
      </div>
      <div className="bt-skeleton-rows">
        <div className="skeleton" style={{ height: 13 }} />
        <div className="skeleton" style={{ height: 13 }} />
        <div className="skeleton" style={{ height: 13 }} />
        <div className="skeleton" style={{ height: 13, width: '75%' }} />
      </div>
    </div>
  )
}
