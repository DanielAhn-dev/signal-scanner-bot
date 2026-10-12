import React from 'react'
import { pct, signedPct, toEokFromWon } from '../lib/format'
import { signalCls } from '../lib/signal'
import { autoTierLabel, matchMeta, pbrMeta } from '../lib/meta'
import AnchoredDropdown from '../../../components/AnchoredDropdown'
import type { AutoPickItem, AutoPickTier, BacktestResponse, ConditionStats, ReturnProfileKey, StockIndicators } from '../types'
import type { Horizon } from '../constants'
import type { buildPatternMatch } from '../lib/patternMatch'
import type { computeInvestSim } from '../lib/backtestView'
import type { bucketAutoPicks } from '../lib/autoPick'

export type CheckTabProps = {
  horizon: Horizon
  data: BacktestResponse
  checkSearch: string
  setCheckSearch: React.Dispatch<React.SetStateAction<string>>
  checkResults: any[]
  setCheckResults: React.Dispatch<React.SetStateAction<any[]>>
  setCheckFocused: React.Dispatch<React.SetStateAction<boolean>>
  selectedStock: { code: string; name: string } | null
  setSelectedStock: React.Dispatch<React.SetStateAction<{ code: string; name: string } | null>>
  indicators: StockIndicators | null
  setIndicators: React.Dispatch<React.SetStateAction<StockIndicators | null>>
  checkLoading: boolean
  checkError: string | null
  setCheckError: React.Dispatch<React.SetStateAction<string | null>>
  autoPickLoading: boolean
  autoPickError: string | null
  autoPicks: AutoPickItem[]
  conditionStats: ConditionStats
  returnProfile: ReturnProfileKey
  minExpectedReturnPct: number
  setMinExpectedReturnPct: React.Dispatch<React.SetStateAction<number>>
  minShortMomentumPct: number
  setMinShortMomentumPct: React.Dispatch<React.SetStateAction<number>>
  minLiquidityEok: number
  setMinLiquidityEok: React.Dispatch<React.SetStateAction<number>>
  investAmount: number
  setInvestAmount: React.Dispatch<React.SetStateAction<number>>
  checkWrapRef: React.RefObject<HTMLDivElement>
  selectStock: (stock: { code: string; name: string }) => void
  goAnalyze: (code: string) => void
  goExecutionGuide: (code: string) => void
  goSimulator: (stock: { code: string; name: string }) => void
  addAutoPicksToSimulator: (tiers: AutoPickTier[]) => void
  applyReturnProfile: (profile: ReturnProfileKey) => void
  patternMatch: ReturnType<typeof buildPatternMatch> | null
  matchedRuleCandidates: Array<{ key: string; label: string; matched: boolean }>
  investSim: ReturnType<typeof computeInvestSim>
  autoPickBuckets: ReturnType<typeof bucketAutoPicks>
  showCheckDropdown: boolean
  hasFundamental: boolean | null
}

export default function CheckTab({
  horizon,
  data,
  checkSearch,
  setCheckSearch,
  checkResults,
  setCheckResults,
  setCheckFocused,
  selectedStock,
  setSelectedStock,
  indicators,
  setIndicators,
  checkLoading,
  checkError,
  setCheckError,
  autoPickLoading,
  autoPickError,
  autoPicks,
  conditionStats,
  returnProfile,
  minExpectedReturnPct,
  setMinExpectedReturnPct,
  minShortMomentumPct,
  setMinShortMomentumPct,
  minLiquidityEok,
  setMinLiquidityEok,
  investAmount,
  setInvestAmount,
  checkWrapRef,
  selectStock,
  goAnalyze,
  goExecutionGuide,
  goSimulator,
  addAutoPicksToSimulator,
  applyReturnProfile,
  patternMatch,
  matchedRuleCandidates,
  investSim,
  autoPickBuckets,
  showCheckDropdown,
  hasFundamental,
}: CheckTabProps) {
  return (
    <div className="bt-section">
      <div className="bt-section-title">종목 패턴 점검</div>
      <p className="bt-check-guide">
        스캔·하이라이트에 등장한 종목을 입력하면 위 역추적에서 발견한 급등 전 패턴과 얼마나
        일치하는지 확인하고, 투자 금액 대비 예상 수익을 계산합니다.
        스캔 목록 외 임의 종목도 조회 가능합니다.
      </p>

      <div
        style={{
          border: '1px solid var(--color-border-muted)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-bg-sunken)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            자동 추천 종목
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            장세 무관 공통분모 점수로 즉시매수/준비/관찰 자동 분류
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-2)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 8,
              marginBottom: 'var(--space-3)',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', display: 'grid', gap: 4 }}>
              기대수익 프리셋
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`sim-btn ${returnProfile === 'strict' ? 'sim-btn--primary' : 'sim-btn--ghost'}`}
                  style={{ minHeight: 30, padding: '6px 10px' }}
                  onClick={() => applyReturnProfile('strict')}
                >
                  실전형
                </button>
                <button
                  type="button"
                  className={`sim-btn ${returnProfile === 'conservative' ? 'sim-btn--primary' : 'sim-btn--ghost'}`}
                  style={{ minHeight: 30, padding: '6px 10px' }}
                  onClick={() => applyReturnProfile('conservative')}
                >
                  보수형
                </button>
                <button
                  type="button"
                  className={`sim-btn ${returnProfile === 'aggressive' ? 'sim-btn--primary' : 'sim-btn--ghost'}`}
                  style={{ minHeight: 30, padding: '6px 10px' }}
                  onClick={() => applyReturnProfile('aggressive')}
                >
                  공격형
                </button>
              </div>
            </div>
            <label style={{ fontSize: 11, color: 'var(--color-text-tertiary)', display: 'grid', gap: 4 }}>
              최소 기대수익률(%)
              <input
                className="sim-input"
                type="number"
                min={-100}
                max={30}
                value={minExpectedReturnPct}
                onChange={(e) =>
                  setMinExpectedReturnPct(Math.max(-100, Math.min(30, Number(e.target.value) || 0)))
                }
              />
            </label>
            <label style={{ fontSize: 11, color: 'var(--color-text-tertiary)', display: 'grid', gap: 4 }}>
              최소 단기모멘텀(%)
              <input
                className="sim-input"
                type="number"
                min={-5}
                max={10}
                step={0.1}
                value={minShortMomentumPct}
                onChange={(e) =>
                  setMinShortMomentumPct(Math.max(-5, Math.min(10, Number(e.target.value) || 0)))
                }
              />
            </label>
            <label style={{ fontSize: 11, color: 'var(--color-text-tertiary)', display: 'grid', gap: 4 }}>
              최소 거래대금(억원)
              <input
                className="sim-input"
                type="number"
                min={0}
                max={50000}
                step={50}
                value={minLiquidityEok}
                onChange={(e) =>
                  setMinLiquidityEok(Math.max(0, Math.min(50000, Number(e.target.value) || 0)))
                }
              />
            </label>
          </div>

          {autoPickLoading && (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>자동 추천 계산 중...</div>
          )}
          {!autoPickLoading && autoPickError && (
            <div style={{ fontSize: 12, color: 'var(--color-error)' }}>{autoPickError}</div>
          )}
          {!autoPickLoading && !autoPickError && autoPicks.length === 0 && (
            <div style={{ display: 'grid', gap: 8, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              <div>
                <strong>현재 스캔 후보 조건 충족률:</strong><br/>
                BUY 신호: {conditionStats.buySignalPct}% · 점수 50+: {conditionStats.score50PlusPct}% · RSI 45-65: {conditionStats.rsi45_65Pct}%
              </div>
              <div>
                현재 조건에 맞는 자동 추천 종목이 없습니다. Horizon/급등 기준을 완화하거나 룰을 변경해 보세요.
              </div>
            </div>
          )}
          {!autoPickLoading && !autoPickError && autoPicks.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              {(['now', 'prepare', 'watch'] as const).map((tier) => {
                const rows = autoPickBuckets[tier]
                if (rows.length === 0) return null
                return (
                  <div key={tier} style={{ display: 'grid', gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                      {autoTierLabel(tier)} · {rows.length}개
                    </div>
                    {rows.map((row) => (
                      <button
                        key={`${tier}-${row.code}`}
                        type="button"
                        className="sim-btn sim-btn--ghost"
                        style={{ flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', gap: 6 }}
                        onClick={() => selectStock({ code: row.code, name: row.name })}
                      >
                        {/* 종목명 + 배지 줄 */}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', width: '100%' }}>
                          <strong style={{ fontSize: 13 }}>{row.name}</strong>
                          <span className="bt-table-stock-code">{row.code}</span>
                          {row.market && (
                            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{row.market}</span>
                          )}
                          <span className={`bt-check-match-badge ${matchMeta(row.coreMatchCount).cls}`}>
                            코어 {row.coreMatchCount}/3
                          </span>
                          {row.ruleMatched && (
                            <span className="bt-check-rule-badge bt-check-rule-badge--on">추천 룰 적합</span>
                          )}
                          <span className={signalCls(row.signal)} style={{ marginLeft: 'auto' }}>{row.signal}</span>
                        </span>
                        {/* 지표 줄 — 모바일에서 wrap */}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, width: '100%' }}>
                          <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>기대 {row.expectedReturnPct.toFixed(1)}%</span>
                          <span style={{ color: 'var(--color-text-secondary)' }}>모멘텀 {signedPct(row.shortMomentumPct, 1)}</span>
                          <span style={{ color: 'var(--color-text-secondary)' }}>거래대금 {toEokFromWon(row.liquidity).toFixed(0)}억</span>
                          <span style={{ color: 'var(--color-text-secondary)' }}>점수 {row.score.toFixed(1)}</span>
                          <span style={{ color: 'var(--color-text-secondary)' }}>RSI {row.rsi14 == null ? '-' : row.rsi14.toFixed(1)}</span>
                          {row.warnGrade && row.warnGrade !== 'SAFE' && (
                            <span style={{ color: 'var(--color-warning)' }}>주의 {row.warnGrade}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <button
                  type="button"
                  className="sim-btn sim-btn--primary"
                  onClick={() => addAutoPicksToSimulator(['now'])}
                >
                  즉시 후보 시뮬레이터 추가
                </button>
                <button
                  type="button"
                  className="sim-btn sim-btn--ghost"
                  onClick={() => addAutoPicksToSimulator(['now', 'prepare'])}
                >
                  즉시+준비 일괄 추가
                </button>
                <button
                  type="button"
                  className="sim-btn sim-btn--ghost"
                  onClick={() => addAutoPicksToSimulator(['now', 'prepare', 'watch'])}
                >
                  즉시+준비+관찰 일괄 추가
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                코어 조건: 점수≥70, BUY계열, RSI 45~65. 단기모멘텀은 장중 등락률 우선, 없으면 ROC21 기반 추정치를 사용합니다.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bt-check-search-wrap" ref={checkWrapRef}>
        <div className="sim-add-input-row">
          <input
            className="sim-add-input"
            placeholder="종목명 또는 코드 입력..."
            value={checkSearch}
            onChange={(e) => {
              setCheckSearch(e.target.value)
              setSelectedStock(null)
              setIndicators(null)
              setCheckError(null)
            }}
            onFocus={() => setCheckFocused(true)}
            onBlur={() => setTimeout(() => setCheckFocused(false), 150)}
          />
          {checkSearch && (
            <button
              className="sim-add-clear"
              onClick={() => {
                setCheckSearch('')
                setSelectedStock(null)
                setIndicators(null)
                setCheckError(null)
                setCheckResults([])
              }}
            >
              ×
            </button>
          )}
        </div>
        {showCheckDropdown && (
          <AnchoredDropdown anchorRef={checkWrapRef} className="sim-add-dropdown">
            {checkResults.slice(0, 6).map((s: any) => (
              <button
                key={s.code}
                className="sim-add-result"
                onClick={() =>
                  selectStock({ code: String(s.code), name: String(s.name ?? s.code) })
                }
              >
                <span className="sim-add-result-name">{s.name ?? s.code}</span>
                <span className="sim-add-result-code">{s.code}</span>
              </button>
            ))}
          </AnchoredDropdown>
        )}
      </div>

      {selectedStock && (
        <div className="bt-check-result">
          <div className="bt-check-stock-head">
            <span className="bt-check-stock-name">
              {indicators?.name ?? selectedStock.name}
            </span>
            <span className="bt-check-stock-code">{selectedStock.code}</span>
            {indicators?.market && (
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'var(--color-bg-sunken)', padding: '2px 6px', borderRadius: 4 }}>
                {indicators.market}
              </span>
            )}
            {checkLoading && <span className="bt-check-loading">지표 조회 중...</span>}
          </div>

          {checkError && (
            <div className="bt-check-not-found" style={{ color: 'var(--color-error)' }}>
              {checkError}
            </div>
          )}

          {!checkLoading && !checkError && indicators && patternMatch && (
            <>
              {/* 기준일 + 현재가 헤더 */}
              {patternMatch.dataDate && (
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>기준일: {patternMatch.dataDate}</span>
                  {indicators.close != null && (
                    <span>현재가 {indicators.close.toLocaleString('ko-KR')}원</span>
                  )}
                  {patternMatch.entryGrade && (
                    <span>눌림목 등급 <strong>{patternMatch.entryGrade}</strong></span>
                  )}
                  {patternMatch.warnGrade && patternMatch.warnGrade !== 'SAFE' && (
                    <span style={{ color: 'var(--color-warning)' }}>⚠ 경고 {patternMatch.warnGrade}</span>
                  )}
                </div>
              )}

              {/* 패턴 조건 3가지 */}
              <div className="bt-check-criteria">
                <div className={`bt-check-criterion ${patternMatch.scoreMatch ? 'bt-check-criterion--match' : 'bt-check-criterion--miss'}`}>
                  <span className="bt-check-criterion-icon">{patternMatch.scoreMatch ? '✅' : '❌'}</span>
                  <div className="bt-check-criterion-info">
                    <span className="bt-check-criterion-label">점수 ≥ 70</span>
                    <span className="bt-check-criterion-current">현재 점수 {patternMatch.score ?? '-'}</span>
                  </div>
                  <span className="bt-check-criterion-stat">급등 전 {pct(data.commonFeatures.score70RatePct)}가 해당</span>
                </div>
                <div className={`bt-check-criterion ${patternMatch.buyMatch ? 'bt-check-criterion--match' : 'bt-check-criterion--miss'}`}>
                  <span className="bt-check-criterion-icon">{patternMatch.buyMatch ? '✅' : '❌'}</span>
                  <div className="bt-check-criterion-info">
                    <span className="bt-check-criterion-label">BUY계열 시그널</span>
                    <span className="bt-check-criterion-current">현재 {patternMatch.signal || '-'}</span>
                  </div>
                  <span className="bt-check-criterion-stat">급등 전 {pct(data.commonFeatures.buySignalRatePct)}가 해당</span>
                </div>
                <div className={`bt-check-criterion ${patternMatch.rsiMatch ? 'bt-check-criterion--match' : 'bt-check-criterion--miss'}`}>
                  <span className="bt-check-criterion-icon">{patternMatch.rsiMatch ? '✅' : '❌'}</span>
                  <div className="bt-check-criterion-info">
                    <span className="bt-check-criterion-label">RSI 45~65 (매집 구간)</span>
                    <span className="bt-check-criterion-current">현재 RSI {patternMatch.rsi ? patternMatch.rsi.toFixed(1) : '-'}</span>
                  </div>
                  <span className="bt-check-criterion-stat">급등 전 {pct(data.commonFeatures.rsi45to65RatePct)}가 해당</span>
                </div>
                <div className="bt-check-match-summary">
                  <span className="bt-check-match-count">{patternMatch.matchCount}/3 조건 충족</span>
                  <span className={`bt-check-match-badge ${matchMeta(patternMatch.matchCount).cls}`}>
                    {matchMeta(patternMatch.matchCount).label}
                  </span>
                </div>
              </div>

              {(data.ruleCandidates ?? []).length > 0 && (
                <div className="bt-check-rule-candidates">
                  <div className="bt-check-rule-candidates-title">추천 룰 TOP 5 매칭</div>
                  <div className="bt-check-rule-candidates-list">
                    {matchedRuleCandidates.map((rule) => (
                      <span
                        key={rule.key}
                        className={`bt-check-rule-badge ${rule.matched ? 'bt-check-rule-badge--on' : 'bt-check-rule-badge--off'}`}
                      >
                        {rule.matched ? '적합' : '미적합'} · {rule.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 펀더멘털 패널 — 장기 보유 판단용 */}
              {hasFundamental && (
                <div className="bt-check-fundamental">
                  <div className="bt-check-fundamental-title">펀더멘털 지표 — 장기 보유 판단용</div>
                  <div className="bt-check-fundamental-grid">
                    {indicators.pbr != null && (() => {
                      const m = pbrMeta(indicators.pbr)
                      return (
                        <div className="bt-check-fund-item">
                          <span className="bt-check-fund-label">PBR</span>
                          <span className={`bt-check-fund-value ${m.cls}`}>{indicators.pbr.toFixed(2)}x</span>
                          <span className="bt-check-fund-note">{m.note}</span>
                        </div>
                      )
                    })()}
                    {indicators.per != null && indicators.per > 0 && (
                      <div className="bt-check-fund-item">
                        <span className="bt-check-fund-label">PER</span>
                        <span className={`bt-check-fund-value ${indicators.per < 10 ? 'bt-check-fund-value--good' : indicators.per > 30 ? 'bt-check-fund-value--warn' : ''}`}>
                          {indicators.per.toFixed(1)}x
                        </span>
                        <span className="bt-check-fund-note">{indicators.per < 10 ? '저PER 저평가' : indicators.per > 30 ? '고PER 주의' : '적정 수준'}</span>
                      </div>
                    )}
                    {indicators.roe != null && (
                      <div className="bt-check-fund-item">
                        <span className="bt-check-fund-label">ROE</span>
                        <span className={`bt-check-fund-value ${indicators.roe >= 15 ? 'bt-check-fund-value--good' : indicators.roe < 5 ? 'bt-check-fund-value--warn' : ''}`}>
                          {indicators.roe.toFixed(1)}%
                        </span>
                        <span className="bt-check-fund-note">{indicators.roe >= 15 ? '우수한 수익성' : indicators.roe < 5 ? '수익성 낮음' : '보통'}</span>
                      </div>
                    )}
                    {indicators.debt_ratio != null && (
                      <div className="bt-check-fund-item">
                        <span className="bt-check-fund-label">부채비율</span>
                        <span className={`bt-check-fund-value ${indicators.debt_ratio > 200 ? 'bt-check-fund-value--bad' : indicators.debt_ratio < 100 ? 'bt-check-fund-value--good' : ''}`}>
                          {indicators.debt_ratio.toFixed(0)}%
                        </span>
                        <span className="bt-check-fund-note">{indicators.debt_ratio > 200 ? '고부채 위험' : indicators.debt_ratio < 100 ? '재무 건전' : '보통'}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 투자 시뮬레이션 */}
              <div className="bt-check-invest">
                <p className="bt-check-invest-title">투자 시뮬레이션 (모든 과거 사례 평균 기준)</p>
                <div className="bt-check-invest-row">
                  <div className="sim-input-row" style={{ maxWidth: 200 }}>
                    <input
                      className="sim-input"
                      type="number"
                      min={0}
                      step={100_000}
                      value={investAmount}
                      onChange={(e) =>
                        setInvestAmount(Math.max(0, Number(e.target.value || 0)))
                      }
                    />
                    <span className="sim-input-suffix">원</span>
                  </div>
                  {investSim && (
                    <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                      <div className="bt-check-invest-result">
                        <span className="bt-check-invest-desc">
                          전체 사례 평균 <strong>{investSim.avgReturn >= 0 ? '+' : ''}{pct(investSim.avgReturn, 2)}</strong> ({horizon}일)
                        </span>
                        <span className="bt-check-invest-gain">
                          {investSim.avgGain >= 0 ? '+' : ''}{Math.round(investSim.avgGain).toLocaleString('ko-KR')}원
                        </span>
                      </div>
                      {investSim.patternReturn != null && investSim.patternGain != null && (
                        <div className="bt-check-invest-result">
                          <span className="bt-check-invest-desc">
                            규칙 일치 사례 평균 <strong>{investSim.patternReturn >= 0 ? '+' : ''}{pct(investSim.patternReturn, 1)}</strong>
                          </span>
                          <span className="bt-check-invest-gain">
                            {investSim.patternGain >= 0 ? '+' : ''}{Math.round(investSim.patternGain).toLocaleString('ko-KR')}원
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <p className="bt-check-invest-note">
                  ※ 급등한 종목만의 평균(+{pct(data.riserSummary.avgForwardReturnPct, 1)})은 결과를 알고 고른 값이라 기대수익이 아닙니다. 위 수치는 급등 여부와 무관한 모든 과거 사례의 평균입니다.
                </p>
              </div>

              {/* 다음 단계 액션 */}
              <div className="bt-check-actions">
                <button
                  className="sim-btn sim-btn--ghost"
                  onClick={() => goAnalyze(selectedStock.code)}
                >
                  📈 상세 분석 보기
                </button>
                <button
                  className="sim-btn sim-btn--ghost"
                  onClick={() => goExecutionGuide(selectedStock.code)}
                >
                  🧭 실행 가이드
                </button>
                <button
                  className="sim-btn sim-btn--primary"
                  onClick={() => goSimulator(selectedStock)}
                >
                  ➕ 시뮬레이터에 추가
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
