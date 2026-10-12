import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import { DIVIDER } from './Divider'
import { advisorStatusStyle, regimeLabel, twoStageActionStyle } from '../lib/styles'
import type { DataValidation } from '../lib/validation'

export type AdvisorSectionProps = {
  result: any
  advisor: any
  dataValidation: DataValidation
}

export default function AdvisorSection({
  result,
  advisor,
  dataValidation,
}: AdvisorSectionProps) {
  return (
    <>
        {advisor && (
          <>
            {DIVIDER}
            <div className="flex-between" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="title-md">상세 규칙 및 가격 관리</div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                {dataValidation.warnings.length > 0 && (
                  <span
                    title={dataValidation.warnings.join('; ')}
                    style={{
                    display: 'inline-block',
                    padding: '0.2rem 0.75rem',
                    borderRadius: 999,
                    fontWeight: 'var(--font-weight-semibold)',
                    fontSize: 'var(--font-size-sm)',
                    background: 'var(--color-warning-bg)',
                    color: 'var(--color-warning)',
                    cursor: 'help',
                  }}>
                    ⚠️ 데이터 검증 필요
                  </span>
                )}
              </div>
            </div>
            <div className="card" style={{ background: 'var(--color-bg-sunken)' }}>
              {/* 판정 배지 */}
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <div className="stat-label" title="점수·진입구간·손익비 고정 규칙으로 정한 판정입니다. 10년 검증에서 점수는 종목 간 수익 차이를 예측하지 못했습니다.">규칙 판정</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '0.2rem 0.75rem',
                    borderRadius: 999,
                    fontWeight: 'var(--font-weight-semibold)',
                    fontSize: 'var(--font-size-sm)',
                    ...advisorStatusStyle(advisor.status),
                  }}>
                    {advisor.statusLabel ?? '—'}
                  </span>
                  <span style={{
                    display: 'inline-block',
                    padding: '0.2rem 0.75rem',
                    borderRadius: 999,
                    fontWeight: 'var(--font-weight-semibold)',
                    fontSize: 'var(--font-size-sm)',
                    background: advisor?.twoStage?.regime === 'risk_on'
                      ? 'var(--color-success-bg)'
                      : advisor?.twoStage?.regime === 'risk_off'
                        ? 'var(--color-error-bg)'
                        : 'var(--color-warning-bg)',
                    color: advisor?.twoStage?.regime === 'risk_on'
                      ? 'var(--color-success)'
                      : advisor?.twoStage?.regime === 'risk_off'
                        ? 'var(--color-error)'
                        : 'var(--color-warning)',
                  }}>
                    1단계 {regimeLabel(advisor?.twoStage?.regime)}
                  </span>
                  <span style={{
                    display: 'inline-block',
                    padding: '0.2rem 0.75rem',
                    borderRadius: 999,
                    fontWeight: 'var(--font-weight-semibold)',
                    fontSize: 'var(--font-size-sm)',
                    ...twoStageActionStyle(advisor?.twoStage?.action),
                  }}>
                    2단계 {advisor?.twoStage?.actionLabel ?? '관망'}
                  </span>
                </div>
                {advisor.signalReason && <div className="caption" style={{ marginBottom: 'var(--space-1)' }}>신호 근거: {advisor.signalReason}</div>}
                {advisor?.twoStage?.reason && (
                  <div className="caption" style={{ marginBottom: 'var(--space-1)' }}>
                    합성 근거: {advisor.twoStage.reason} · 권장 비중 {advisor?.twoStage?.allocationPct != null ? `${formatNumber(advisor.twoStage.allocationPct, 0)}%` : '—'}
                  </div>
                )}
                {advisor.summary && <div className="caption">{advisor.summary}</div>}
              </div>

              {/* 진입구간 / 손절 / 목표 — 고정 규칙(손절 5.5~8%·목표 3~18%)으로 만든 가격이며 예측이 아니다 */}
              <div className="caption" style={{ marginBottom: 'var(--space-2)' }}>
                아래 가격은 고정 규칙(손절 5.5~8%, 목표 +3~18%)으로 정한 관리 기준입니다. 도달 확률을 뜻하지 않습니다.
              </div>
              <div className="cards-grid cols-2" style={{ marginBottom: 'var(--space-3)' }}>
                <div style={{
                  background: 'var(--color-success-bg)',
                  border: '1px solid rgba(0,180,147,0.25)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                }}>
                  <div className="stat-label" style={{ color: 'var(--color-success)' }}>진입구간</div>
                  <div style={{ fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-base)' }}>
                    {advisor.entryLow != null && advisor.entryHigh != null
                      ? `${formatKrw(advisor.entryLow)} ~ ${formatKrw(advisor.entryHigh)}`
                      : '—'}
                  </div>
                </div>
                <div style={{
                  background: 'var(--color-error-bg)',
                  border: '1px solid rgba(240,68,82,0.25)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                }}>
                  <div className="stat-label" style={{ color: 'var(--color-error)' }}>손절기준</div>
                  <div style={{ fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-base)' }}>
                    {advisor.stopPrice != null
                      ? `${formatKrw(advisor.stopPrice)} (${advisor.stopPct != null ? `-${formatNumber(Math.abs(advisor.stopPct * 100), 2)}%` : '—'})`
                      : '—'}
                  </div>
                </div>
                <div style={{
                  background: 'var(--color-info-bg)',
                  border: '1px solid rgba(0,96,255,0.15)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                }}>
                  <div className="stat-label" style={{ color: 'var(--color-info)' }}>1차 목표</div>
                  <div style={{ fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-base)' }}>
                    {advisor.target1 != null
                      ? `${formatKrw(advisor.target1)} (${advisor.target1Pct != null ? `+${formatNumber(advisor.target1Pct * 100, 2)}%` : '—'})`
                      : '—'}
                  </div>
                </div>
                <div style={{
                  background: 'var(--color-info-bg)',
                  border: '1px solid rgba(0,96,255,0.15)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                }}>
                  <div className="stat-label" style={{ color: 'var(--color-info)' }}>2차 목표</div>
                  <div style={{ fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-base)' }}>
                    {advisor.target2 != null
                      ? `${formatKrw(advisor.target2)} (${advisor.target2Pct != null ? `+${formatNumber(advisor.target2Pct * 100, 2)}%` : '—'})`
                      : '—'}
                  </div>
                </div>
              </div>

              {/* 트레일링 스탑 가이드 */}
              {advisor.entryLow != null && (
                <div style={{
                  background: 'var(--color-warning-bg, rgba(255,170,0,0.08))',
                  border: '1px solid rgba(200,140,0,0.2)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                  marginBottom: 'var(--space-2)',
                }}>
                  <div className="stat-label" style={{ color: 'var(--color-warning-text, #a07000)', marginBottom: 'var(--space-1)' }}>
                    트레일링 스탑 기준 (참고용)
                  </div>
                  {(() => {
                    const baseEntry = advisor.entryLow ?? result.close ?? 0
                    const TRAILING_ARM_PCT = 5   // 활성화 수익률
                    const TRAILING_STOP_PCT = 10 // 고점 대비 이탈 %
                    const trailingArmPrice = baseEntry > 0 ? Math.round(baseEntry * (1 + TRAILING_ARM_PCT / 100)) : null
                    return (
                      <div className="caption" style={{ lineHeight: '1.7' }}>
                        <span>• 진입 후 <strong>+{TRAILING_ARM_PCT}%</strong> 도달 시 트레일링 활성화</span><br />
                        {trailingArmPrice && (
                          <><span style={{ paddingLeft: '1em' }}>→ 활성화 기준가 약 <strong>{formatKrw(trailingArmPrice)}</strong></span><br /></>
                        )}
                        <span>• 이후 고점 대비 <strong>-{TRAILING_STOP_PCT}%</strong> 이탈 시 익절</span><br />
                        <span>• 손절: 진입가(평단) 대비 <strong>-{advisor.stopPct != null ? `${Math.abs(advisor.stopPct * 100).toFixed(1)}%` : '10%'}</strong></span><br />
                        <span style={{ opacity: 0.7 }}>※ 상방은 무제한 — 고점 추적으로 수익 보호. 가상매매 자동사이클에 적용 중.</span>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* 판단 근거 */}
              {Array.isArray(advisor.rationale) && advisor.rationale.length > 0 && (
                <div style={{ marginBottom: 'var(--space-2)' }}>
                  <div className="stat-label">판단 근거</div>
                  {advisor.rationale.map((line: string, i: number) => (
                    <div key={`r-${i}`} className="caption">- {line}</div>
                  ))}
                </div>
              )}

              {/* 주의 */}
              {Array.isArray(advisor.warnings) && advisor.warnings.length > 0 && (
                <div style={{ marginBottom: 'var(--space-2)' }}>
                  <div className="stat-label">주의</div>
                  {advisor.warnings.map((line: string, i: number) => (
                    <div key={`w-${i}`} className="caption" style={{ color: 'var(--color-error)' }}>- {line}</div>
                  ))}
                </div>
              )}

            </div>
          </>
        )}
    </>
  )
}
