import React from 'react'
import { formatKrw } from '../../../lib/format'
import type { decideEntry, AnalysisCoverage, DataValidation } from '../lib/validation'

export type DecisionCardProps = {
  advisor: any
  entryDecision: ReturnType<typeof decideEntry>
  analysisCoverage: AnalysisCoverage
  dataValidation: DataValidation
}

export default function DecisionCard({
  advisor,
  entryDecision,
  analysisCoverage,
  dataValidation,
}: DecisionCardProps) {
  return (
      <section className={`analyze-decision analyze-decision--${entryDecision.tone}`} aria-label="현재 진입 판단">
        <div className="analyze-decision__primary">
          <div className="analyze-decision__label">현재 판단</div>
          <div className="analyze-decision__value">{entryDecision.label}</div>
          <div className="analyze-decision__reason">{entryDecision.reason}</div>
        </div>
        <dl className="analyze-decision__facts">
          <div>
            <dt>규칙 판정</dt>
            <dd>{advisor?.statusLabel || '판정 없음'}</dd>
          </div>
          <div>
            <dt>진입 구간</dt>
            <dd>{advisor?.entryLow != null && advisor?.entryHigh != null ? `${formatKrw(advisor.entryLow)} ~ ${formatKrw(advisor.entryHigh)}` : '산출 불가'}</dd>
          </div>
          <div>
            <dt>데이터 충족도</dt>
            <dd>{analysisCoverage.available}/{analysisCoverage.total}</dd>
          </div>
        </dl>
        {(analysisCoverage.missing.length > 0 || analysisCoverage.creditIsProxy || dataValidation.warnings.length > 0) && (
          <div className="analyze-decision__data-note">
            {analysisCoverage.missing.length > 0 && <span>미확보: {analysisCoverage.missing.join(', ')}</span>}
            {analysisCoverage.creditIsProxy && <span>공매도/신용은 실데이터 대신 프록시 반영</span>}
            {dataValidation.warnings.length > 0 && <span>{dataValidation.warnings[0]}</span>}
          </div>
        )}
      </section>
  )
}
