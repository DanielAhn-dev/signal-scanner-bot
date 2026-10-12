import React from 'react'
import { pct, signedPct } from '../lib/format'
import { signalCls } from '../lib/signal'
import { confidenceMeta } from '../lib/meta'
import type { BacktestResponse, BacktestRiser } from '../types'

export type SummaryTabProps = {
  data: BacktestResponse
  selectedRuleKey: string | null
  setSelectedRuleKey: React.Dispatch<React.SetStateAction<string | null>>
  showAllFeatureRows: boolean
  setShowAllFeatureRows: React.Dispatch<React.SetStateAction<boolean>>
  selectStock: (stock: { code: string; name: string }) => void
  filteredSamplesByRule: BacktestRiser[]
  visibleFeatureStats: NonNullable<BacktestResponse['featureStats']>
  hiddenFeatureCount: number
}

export default function SummaryTab({
  data,
  selectedRuleKey,
  setSelectedRuleKey,
  showAllFeatureRows,
  setShowAllFeatureRows,
  selectStock,
  filteredSamplesByRule,
  visibleFeatureStats,
  hiddenFeatureCount,
}: SummaryTabProps) {
  return (
    <>
    <div className="bt-summary-card">
      <div className="bt-summary-grid">
        <div className="bt-summary-item">
          <span className="bt-summary-label">라벨 가능 이벤트</span>
          <span className="bt-summary-value">
            {data.baseline.labelableEvents.toLocaleString('ko-KR')}건
          </span>
        </div>
        <div className="bt-summary-item">
          <span className="bt-summary-label">급등 이벤트</span>
          <span className="bt-summary-value">
            {data.riserSummary.riserEvents.toLocaleString('ko-KR')}건
          </span>
        </div>
        <div className="bt-summary-item">
          <span className="bt-summary-label" title="급등한 종목만의 평균(사후 선택). 기대수익이 아닙니다.">급등 종목 평균(사후)</span>
          <span className="bt-summary-value" style={{ color: 'var(--color-success)' }}>
            +{pct(data.riserSummary.avgForwardReturnPct, 2)}
          </span>
        </div>
        <div className="bt-summary-item">
          <span className="bt-summary-label">score≥70 비중(Lift)</span>
          <span className="bt-summary-value">
            {pct(data.commonFeatures.score70RatePct)}
            <span className="bt-summary-lift">
              {' '}({data.commonFeatures.score70LiftPct >= 0 ? '+' : ''}
              {pct(data.commonFeatures.score70LiftPct)})
            </span>
          </span>
        </div>
        <div className="bt-summary-item">
          <span className="bt-summary-label">BUY계열 비중(Lift)</span>
          <span className="bt-summary-value">
            {pct(data.commonFeatures.buySignalRatePct)}
            <span className="bt-summary-lift">
              {' '}({data.commonFeatures.buySignalLiftPct >= 0 ? '+' : ''}
              {pct(data.commonFeatures.buySignalLiftPct)})
            </span>
          </span>
        </div>
        <div className="bt-summary-item">
          <span className="bt-summary-label">RSI 45~65 비중 (매집 구간)</span>
          <span className="bt-summary-value">
            {pct(data.commonFeatures.rsi45to65RatePct)}
          </span>
        </div>
      </div>
    </div>
    <div className="bt-section">
      <div className="bt-section-title">공통점 탐색 리포트 (Support / Lift / Precision)</div>
      <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 var(--space-3)', lineHeight: 1.55 }}>
        Support는 급등 이벤트 내 해당 특징의 커버리지, Lift는 전체 이벤트 대비 강화 정도,
        Precision은 해당 룰이 잡은 이벤트 중 급등 비율입니다.
      </p>

      {(data.featureStats ?? []).length > 0 ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              기본은 의미 있는 행만 표시하고, 전체보기로 나머지도 확인할 수 있습니다.
              {!showAllFeatureRows && hiddenFeatureCount > 0 && (
                <span style={{ marginLeft: 8 }}>
                  숨김 {hiddenFeatureCount}개
                </span>
              )}
            </div>
            <button
              className="sim-btn sim-btn--ghost"
              onClick={() => setShowAllFeatureRows((value) => !value)}
              style={{ padding: '6px 10px', minHeight: 'unset' }}
            >
              {showAllFeatureRows ? '유의미한 값만 보기' : '전체보기'}
            </button>
          </div>
        <div className="mobile-card-table" style={{ overflowX: 'auto', margin: '0 calc(-1 * var(--space-4))' }}>
          <table className="bt-table" style={{ minWidth: 940 }}>
            <thead>
              <tr>
                <th>특징</th>
                <th style={{ textAlign: 'right' }}>Baseline 수</th>
                <th style={{ textAlign: 'right' }}>Baseline 비중</th>
                <th style={{ textAlign: 'right' }}>Riser 수</th>
                <th style={{ textAlign: 'right' }}>Riser 비중</th>
                <th style={{ textAlign: 'right' }}>Lift</th>
                <th style={{ textAlign: 'right' }}>Support</th>
              </tr>
            </thead>
            <tbody>
              {visibleFeatureStats.length > 0 ? (
                visibleFeatureStats.map((row) => (
                  <tr key={row.key}>
                    <td data-th="특징">
                      <span>{row.label}</span>
                      <span className={`bt-check-match-badge ${confidenceMeta(Math.min(row.baselineMatches, row.riserMatches)).cls}`} style={{ marginLeft: 8 }}>
                        {confidenceMeta(Math.min(row.baselineMatches, row.riserMatches)).label}
                      </span>
                    </td>
                    <td className="bt-table-num" style={{ textAlign: 'right' }} data-th="Baseline 수">{row.baselineMatches.toLocaleString('ko-KR')}</td>
                    <td className="bt-table-num" style={{ textAlign: 'right' }} data-th="Baseline 비중">{pct(row.baselineRatePct)}</td>
                    <td className="bt-table-num" style={{ textAlign: 'right' }} data-th="Riser 수">{row.riserMatches.toLocaleString('ko-KR')}</td>
                    <td className="bt-table-num" style={{ textAlign: 'right' }} data-th="Riser 비중">{pct(row.riserRatePct)}</td>
                    <td style={{ textAlign: 'right' }} data-th="Lift">
                      <span className={row.liftPct >= 0 ? 'bt-table-return-pos' : 'bt-table-return-neg'}>
                        {signedPct(row.liftPct)}
                      </span>
                    </td>
                    <td className="bt-table-num" style={{ textAlign: 'right' }} data-th="Support">{pct(row.supportPct)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '18px 12px', color: 'var(--color-text-tertiary)' }}>
                    기본 필터에서 보여줄 유의미한 행이 없습니다. 전체보기를 눌러 모든 구간을 확인하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
          공통점 통계를 계산할 데이터가 부족합니다.
        </p>
      )}

      <div style={{ height: 'var(--space-3)' }} />

      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 8 }}>
        추천 패턴 룰 TOP 5
      </div>
      {(data.ruleCandidates ?? []).length > 0 ? (
        <>
          <div style={{ marginBottom: 'var(--space-3)', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            지표 기반 자동 순위: 실제 급등 정확도(Precision) 중심으로 정렬됨. 행 클릭 시 선택 가능.
          </div>
          <div className="mobile-card-table" style={{ overflowX: 'auto', margin: '0 calc(-1 * var(--space-4))' }}>
            <table className="bt-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>룰</th>
                  <th style={{ textAlign: 'right' }}>Support</th>
                  <th style={{ textAlign: 'right' }}>Lift</th>
                  <th style={{ textAlign: 'right' }}>Precision</th>
                  <th style={{ textAlign: 'right' }}>매칭 이벤트</th>
                  <th style={{ textAlign: 'right' }}>급등 매칭</th>
                </tr>
              </thead>
              <tbody>
                {(data.ruleCandidates ?? []).map((row, idx) => (
                  <tr
                    key={row.key}
                    onClick={() => setSelectedRuleKey(row.key)}
                    style={{
                      cursor: 'pointer',
                      background:
                        selectedRuleKey === row.key
                          ? 'var(--color-info-bg)'
                          : idx === 0
                          ? 'var(--color-success-bg)'
                          : 'transparent',
                    }}
                  >
                    <td data-th="룰">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {idx === 0 && (
                        <span
                          style={{
                            display: 'inline-block',
                            background: 'var(--color-success)',
                            color: '#fff',
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: 10,
                            fontWeight: 700,
                            marginRight: 6,
                          }}
                        >
                          추천
                        </span>
                      )}
                      <span>{row.label}</span>
                      <span className={`bt-check-match-badge ${confidenceMeta(row.matchedEvents).cls}`}>
                        {confidenceMeta(row.matchedEvents).label}
                      </span>
                      </div>
                    </td>
                    <td className="bt-table-num" style={{ textAlign: 'right' }} data-th="Support">
                      {pct(row.supportPct)}
                    </td>
                    <td style={{ textAlign: 'right' }} data-th="Lift">
                      <span className={row.liftPct >= 0 ? 'bt-table-return-pos' : 'bt-table-return-neg'}>
                        {signedPct(row.liftPct)}
                      </span>
                    </td>
                    <td
                      className="bt-table-num"
                      style={{
                        textAlign: 'right',
                        fontWeight: idx === 0 ? 700 : 400,
                        color: idx === 0 ? 'var(--color-success)' : 'var(--color-text-secondary)',
                      }}
                      data-th="Precision"
                    >
                      {pct(row.precisionPct)}
                    </td>
                    <td className="bt-table-num" style={{ textAlign: 'right' }} data-th="매칭 이벤트">
                      {row.matchedEvents.toLocaleString('ko-KR')}
                    </td>
                    <td className="bt-table-num" style={{ textAlign: 'right' }} data-th="급등 매칭">
                      {row.riserMatches.toLocaleString('ko-KR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedRuleKey && (
            <div
              style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-info-bg)',
                border: '1px solid var(--color-info)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-info)', marginBottom: 6 }}>
                선택한 룰의 성능
              </div>
              {(() => {
                const selected = (data.ruleCandidates ?? []).find((r) => r.key === selectedRuleKey)
                if (!selected) return null
                return (
                  <div style={{ fontSize: 12, color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
                    <div>
                      <strong>{selected.label}</strong>
                    </div>
                    <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        급등 예측 정확도:{' '}
                        <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>
                          {pct(selected.precisionPct)}
                        </span>
                        <br />
                        (이 룰에 매칭된 {selected.matchedEvents.toLocaleString('ko-KR')}개 이벤트 중{' '}
                        {selected.riserMatches.toLocaleString('ko-KR')}개가 실제 급등)
                      </div>
                      <div>
                        급등 이벤트 포괄:{' '}
                        <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                          {pct(selected.supportPct)}
                        </span>
                        <br />
                        (전체 급등 이벤트 중 이 룰로 잡히는 비중)
                      </div>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                      ※ 이 룰의 적중률과 커버리지로 성능을 판단할 수 있습니다.
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* 선택한 룰의 실제 샘플 */}
          {selectedRuleKey && filteredSamplesByRule.length > 0 && (
            <div
              style={{
                marginTop: 'var(--space-4)',
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-success-bg)',
                border: '1px solid var(--color-success)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-success)', marginBottom: 12 }}>
                이 룰이 잡은 급등 샘플 ({filteredSamplesByRule.length}건)
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
                아래 {Math.min(5, filteredSamplesByRule.length)}개의 대표 사례를 보면 "{(() => {
                  const rule = (data.ruleCandidates ?? []).find((r) => r.key === selectedRuleKey)
                  return rule?.label || ''
                })()} 규칙의 정확도 {(() => {
                  const rule = (data.ruleCandidates ?? []).find((r) => r.key === selectedRuleKey)
                  return rule?.precisionPct.toFixed(1) || '0'
                })()}%가 어떻게 나왔는지" 직관적으로 검증할 수 있습니다.
              </div>
              <div className="mobile-card-table" style={{ overflowX: 'auto' }}>
                <table className="bt-table" style={{ minWidth: 680 }}>
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th>기준일</th>
                      <th style={{ textAlign: 'right' }}>Horizon 수익률</th>
                      <th style={{ textAlign: 'right' }}>점수</th>
                      <th>시그널</th>
                      <th style={{ textAlign: 'right' }}>RSI14</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSamplesByRule.slice(0, 5).map((row) => (
                      <tr
                        key={`${row.code}-${row.asof}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() =>
                          selectStock({ code: row.code, name: row.name || row.code })
                        }
                      >
                        <td data-th="종목">
                          <span className="bt-table-stock-name">{row.name || row.code}</span>
                          {row.name && (
                            <span className="bt-table-stock-code">{row.code}</span>
                          )}
                        </td>
                        <td className="bt-table-num" data-th="기준일">{row.asof}</td>
                        <td style={{ textAlign: 'right' }} data-th="Horizon 수익률">
                          <span className={row.forwardReturnPct >= 0 ? 'bt-table-return-pos' : 'bt-table-return-neg'}>
                            {row.forwardReturnPct > 0 ? '+' : ''}
                            {pct(row.forwardReturnPct, 2)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="bt-table-num" data-th="점수">
                          {row.totalScore.toFixed(1)}
                        </td>
                        <td data-th="시그널">
                          {row.signal ? (
                            <span className={signalCls(row.signal)}>{row.signal}</span>
                          ) : (
                            <span className="bt-table-num">-</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className="bt-table-num" data-th="RSI14">
                          {row.rsi14 == null ? '-' : row.rsi14.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredSamplesByRule.length > 5 && (
                <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 'var(--space-3) 0 0' }}>
                  ※ 이 규칙에 매칭되는 총 {filteredSamplesByRule.length}건 중 상위 5개를 표시합니다. 종목 클릭으로 패턴 점검 가능.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
          추천 룰을 계산할 표본이 충분하지 않습니다.
        </p>
      )}
    </div>
    </>
  )
}
