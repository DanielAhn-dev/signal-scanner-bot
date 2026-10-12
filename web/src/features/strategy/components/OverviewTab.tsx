import React from 'react'
import Skeleton from '../../../components/Skeleton'
import { formatKstDateTime } from '../../../lib/format'
import { EmptyState, ErrorState } from '../../../components/StateViews'
import { formatMarketRegimeLabel, formatTriggerLabel } from '../lib/labels'
import { getPreRallyBadge } from '../lib/preRally'
import { COLOR_NEGATIVE, COLOR_POSITIVE, COLOR_WARNING, STRATEGY_OPTIONS } from '../constants'
import type { AdaptiveInsights, AutoTradeSettings, DecisionRow, PreRallyPattern, PreRallyReport, PreRallySortKey } from '../types'
import type { summarizeDecisions } from '../lib/decisionSummary'

export type OverviewTabProps = {
  rows: DecisionRow[]
  decLoading: boolean
  decError: string | null
  loadDecisions: () => void | Promise<void>
  settings: AutoTradeSettings | null
  settingsLoading: boolean
  adaptiveInsights: AdaptiveInsights | null
  adaptiveLoading: boolean
  preRallyReport: PreRallyReport | null
  preRallyLoading: boolean
  preRallyHorizon: 20 | 40 | 60
  setPreRallyHorizon: (value: 20 | 40 | 60) => void
  preRallySortKey: PreRallySortKey
  setPreRallySortKey: (value: PreRallySortKey) => void
  preRallyInvestManwon: number
  setPreRallyInvestManwon: (value: number) => void
  sortedPreRallyPatterns: PreRallyPattern[]
  summary: ReturnType<typeof summarizeDecisions>
  currentStrategyInfo: (typeof STRATEGY_OPTIONS)[number]
}

export default function OverviewTab({
  rows,
  decLoading,
  decError,
  loadDecisions,
  settings,
  settingsLoading,
  adaptiveInsights,
  adaptiveLoading,
  preRallyReport,
  preRallyLoading,
  preRallyHorizon,
  setPreRallyHorizon,
  preRallySortKey,
  setPreRallySortKey,
  preRallyInvestManwon,
  setPreRallyInvestManwon,
  sortedPreRallyPatterns,
  summary,
  currentStrategyInfo,
}: OverviewTabProps) {
  return (
    <>
      <div
        className="card mb-4"
        style={{
          borderLeft: `4px solid ${currentStrategyInfo.color}`,
          background: `color-mix(in srgb, ${currentStrategyInfo.color} 6%, var(--color-surface-card))`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="caption" style={{ marginBottom: 2 }}>현재 운용 전략</div>
            <div className="title-lg" style={{ color: currentStrategyInfo.color }}>
              {currentStrategyInfo.label}
            </div>
            <div className="muted" style={{ marginTop: 2 }}>{currentStrategyInfo.desc}</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div className="caption">자동매매 상태</div>
            <div className="title-md" style={{ color: settings?.is_enabled ? COLOR_POSITIVE : COLOR_NEGATIVE }}>
              {settingsLoading ? '…' : settings?.is_enabled ? '활성화' : '비활성화'}
            </div>
          </div>
        </div>
      </div>

      {!settingsLoading && settings && (
        <>
          <div className="cards-list mb-4">
            <div className="card">
              <div className="caption">최소 매수 점수</div>
              <div className="title-lg">{settings.min_buy_score ?? 72}</div>
            </div>
            <div className="card">
              <div className="caption">익절 / 손절 기준</div>
              <div className="title-lg">{settings.take_profit_pct ?? 8}% / {settings.stop_loss_pct ?? 4}%</div>
            </div>
            <div className="card">
              <div className="caption">최대 보유 종목</div>
              <div className="title-lg">{settings.max_positions ?? 10}종목</div>
            </div>
            <div className="card">
              <div className="caption">회차당 신규 매수 슬롯</div>
              <div className="title-lg">{settings.monday_buy_slots ?? 2}개</div>
            </div>
          </div>

        </>
      )}

      <div className="card mb-4">
        <div className="flex-between" style={{ alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
          <div className="title-md">적응형 전략 엔진</div>
          {adaptiveInsights?.latestTradeDate && <div className="caption">기준일 {adaptiveInsights.latestTradeDate}</div>}
        </div>
        <div className="muted" style={{ marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>
          최근 눌림목 후보의 실제 {adaptiveInsights?.horizonBars ?? 3}거래일 성과를 기준으로, 현재 스캔/하이라이트 후보 정렬에 반영 중인 적응 가중치입니다.
        </div>
        {adaptiveLoading && <Skeleton lines={4} height={12} />}
        {!adaptiveLoading && adaptiveInsights && (
          <>
            <div className="cards-list" style={{ marginBottom: 16 }}>
              <div className="card">
                <div className="caption">적응 강도</div>
                <div className="title-lg">{adaptiveInsights.strengthScore}</div>
              </div>
              <div className="card">
                <div className="caption">최근 적중률</div>
                <div className="title-lg">{adaptiveInsights.baseHitRatePct}%</div>
              </div>
              <div className="card">
                <div className="caption">평균 {adaptiveInsights.horizonBars}일 수익률</div>
                <div className="title-lg" style={{ color: adaptiveInsights.baseAvgReturnPct >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE }}>
                  {adaptiveInsights.baseAvgReturnPct > 0 ? '+' : ''}{adaptiveInsights.baseAvgReturnPct}%
                </div>
              </div>
              <div className="card">
                <div className="caption">현재 우위 패턴</div>
                <div className="title-md">{adaptiveInsights.todayBiasSummary}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div className="caption" style={{ marginBottom: 8 }}>강화 중인 기준</div>
                {adaptiveInsights.topPositiveFactors.length === 0 && <div className="muted">강화 기준 없음</div>}
                {adaptiveInsights.topPositiveFactors.map((item) => (
                  <div key={`${item.key}-${item.factor}`} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontWeight: 500 }}>{item.label}</span>
                      <span style={{ color: COLOR_POSITIVE, fontWeight: 600 }}>+{item.weight}</span>
                    </div>
                    <div className="caption">승률 {item.winRatePct}% · 평균 {item.avgForwardReturnPct > 0 ? '+' : ''}{item.avgForwardReturnPct}% · 샘플 {item.sampleCount}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="caption" style={{ marginBottom: 8 }}>약화 중인 기준</div>
                {adaptiveInsights.topNegativeFactors.length === 0 && <div className="muted">약화 기준 없음</div>}
                {adaptiveInsights.topNegativeFactors.map((item) => (
                  <div key={`${item.key}-${item.factor}`} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontWeight: 500 }}>{item.label}</span>
                      <span style={{ color: COLOR_NEGATIVE, fontWeight: 600 }}>{item.weight}</span>
                    </div>
                    <div className="caption">승률 {item.winRatePct}% · 평균 {item.avgForwardReturnPct > 0 ? '+' : ''}{item.avgForwardReturnPct}% · 샘플 {item.sampleCount}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {!adaptiveLoading && !adaptiveInsights && <div className="muted">적응형 전략 데이터를 아직 계산하지 못했습니다.</div>}
      </div>

      <div className="card mb-4">
        <div className="flex-between" style={{ alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
          <div className="title-md">프리랠리 패턴 (웹 리포트)</div>
          {preRallyReport?.generatedAt && (
            <div className="caption">생성 {formatKstDateTime(preRallyReport.generatedAt)}</div>
          )}
        </div>
        <div className="muted" style={{ marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>
          오프라인 분석 결과를 웹에서 읽기 전용으로 확인합니다. horizon(20/40/60)과 정렬 기준을 바꿔 비교하세요.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {[20, 40, 60].map((h) => (
            <button
              key={h}
              className={`sector-tab-btn${preRallyHorizon === h ? ' sector-tab-btn--active' : ''}`}
              onClick={() => setPreRallyHorizon(h as 20 | 40 | 60)}
            >
              {h}거래일
            </button>
          ))}
          <label className="caption" style={{ marginLeft: 8 }}>정렬</label>
          <select
            value={preRallySortKey}
            onChange={(e) => setPreRallySortKey(e.target.value as PreRallySortKey)}
            style={{ minWidth: 130 }}
          >
            <option value="lift">Lift 순</option>
            <option value="win">승률 순</option>
            <option value="ret">평균수익률 순</option>
            <option value="samples">표본수 순</option>
          </select>
          <label className="caption" style={{ marginLeft: 8 }}>가정 투자금(만원)</label>
          <input
            type="number"
            min={10}
            step={10}
            value={preRallyInvestManwon}
            onChange={(e) => setPreRallyInvestManwon(Math.max(10, Number(e.target.value) || 10))}
            style={{ width: 120 }}
          />
        </div>

        {preRallyLoading && <Skeleton lines={4} height={12} />}

        {!preRallyLoading && preRallyReport && (
          <>
            <div className="cards-list" style={{ marginBottom: 16 }}>
              <div className="card">
                <div className="caption">라벨 표본</div>
                <div className="title-lg">{preRallyReport.dataset?.labeledRows ?? 0}</div>
              </div>
              <div className="card">
                <div className="caption">테스트 승률</div>
                <div className="title-lg">{preRallyReport.baseline?.testWinRatePct ?? 0}%</div>
              </div>
              <div className="card">
                <div className="caption">안정 패턴 수</div>
                <div className="title-lg">{preRallyReport.stablePatterns?.length ?? 0}</div>
              </div>
              <div className="card">
                <div className="caption">리포트 파일</div>
                <div className="title-md" style={{ fontSize: 'var(--font-size-sm)' }}>{preRallyReport.fileName ?? '-'}</div>
              </div>
            </div>

            {sortedPreRallyPatterns.length === 0 && (
              <div className="muted">현재 기준에서 안정 패턴이 없습니다. 분석 파라미터를 조정해 리포트를 다시 생성하세요.</div>
            )}

            {sortedPreRallyPatterns.map((item) => {
              const badge = getPreRallyBadge({
                lift: item.liftVsBasePct,
                win: item.winRatePct,
                mdd: item.avgMaxDrawdownPct,
              })
              const principal = preRallyInvestManwon * 10_000
              const expectedPnl = Math.round(principal * (item.avgForwardReturnPct / 100))
              return (
              <div key={item.name} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontWeight: 600 }}>
                    {item.name}
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 'var(--font-size-xs)',
                        color: badge.color,
                        border: `1px solid ${badge.color}`,
                        borderRadius: 999,
                        padding: '2px 8px',
                      }}
                    >
                      {badge.label}
                    </span>
                  </span>
                  <span style={{ color: item.liftVsBasePct >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE, fontWeight: 700 }}>
                    Lift {item.liftVsBasePct > 0 ? '+' : ''}{item.liftVsBasePct}%
                  </span>
                </div>
                <div className="caption">
                  승률 {item.winRatePct}% · 평균 {item.avgForwardReturnPct > 0 ? '+' : ''}{item.avgForwardReturnPct}% · MDD {item.avgMaxDrawdownPct}% · 샘플 {item.samples}
                </div>
                <div className="caption" style={{ marginTop: 2 }}>
                  과거 가정손익(투자금 {preRallyInvestManwon.toLocaleString('ko-KR')}만원): {expectedPnl >= 0 ? '+' : ''}{expectedPnl.toLocaleString('ko-KR')}원
                </div>
              </div>
              )
            })}

            {(preRallyReport.notes ?? []).length > 0 && (
              <div className="caption" style={{ marginTop: 8 }}>
                노트: {(preRallyReport.notes ?? []).join(' | ')}
              </div>
            )}
          </>
        )}

        {!preRallyLoading && !preRallyReport && <div className="muted">pre-rally 리포트를 아직 찾지 못했습니다.</div>}
      </div>

      {decError && <ErrorState message={decError} onRetry={loadDecisions} />}
      {decLoading && <div className="card mb-4"><Skeleton lines={4} height={14} /></div>}
      {!decLoading && !decError && rows.length > 0 && (
        <>
          <div className="cards-list mb-4">
            <div className="card">
              <div className="caption">누적 의사결정</div>
              <div className="title-lg">{summary.total}건</div>
            </div>
            <div className="card">
              <div className="caption">자동 의사결정 비중</div>
              <div className="title-lg">{summary.autoRatio}%</div>
              <div className="muted">({summary.autoCount}건)</div>
            </div>
            <div className="card">
              <div className="caption">매수 / 매도 횟수</div>
              <div className="title-lg">{summary.buyCount} / {summary.sellCount}</div>
            </div>
          </div>

          <div className="cards-list mb-4">
            <div className="card">
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>주요 트리거 빈도</div>
              {summary.topTriggers.length === 0 && <div className="muted">데이터 없음</div>}
              {summary.topTriggers.map(([trigger, count]) => {
                const maxCount = summary.topTriggers[0]?.[1] ?? 1
                const pct = Math.round((count / maxCount) * 100)
                return (
                  <div key={trigger} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span className="caption">{formatTriggerLabel(trigger)}</span>
                      <span className="caption">{count}건</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--color-border-subtle)', borderRadius: 3 }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: 'var(--color-brand)',
                          borderRadius: 3,
                          transition: 'width 0.4s',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="card">
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>시장 국면 분포</div>
              {summary.topRegimes.length === 0 && <div className="muted">데이터 없음</div>}
              {summary.topRegimes.map(([regime, count]) => {
                const maxCount = summary.topRegimes[0]?.[1] ?? 1
                const pct = Math.round((count / maxCount) * 100)
                return (
                  <div key={regime} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span className="caption">{formatMarketRegimeLabel(regime)}</span>
                      <span className="caption">{count}건</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--color-border-subtle)', borderRadius: 3 }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: COLOR_WARNING,
                          borderRadius: 3,
                          transition: 'width 0.4s',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="card">
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>전략 버전 분포</div>
              {summary.topVersions.length === 0 && <div className="muted">데이터 없음</div>}
              {summary.topVersions.map(([version, count]) => (
                <div key={version} className="caption" style={{ marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{version}</span>
                  <span className="muted"> · {count}건</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {!decLoading && !decError && rows.length === 0 && (
        <EmptyState
          title="의사결정 데이터 없음"
          description="자동매매가 실행되면 여기에 전략 현황이 표시됩니다."
        />
      )}
    </>
  )
}
