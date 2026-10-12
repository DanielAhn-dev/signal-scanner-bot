import { formatNumber } from '../../../lib/format'
import { STRATEGY_FILTER_BY_METRIC_KEY } from '../constants'
import { StrategySparkline } from './Sparklines'
import type { ScanPanelState } from '../types'
import type { StrategyLookbackDays, StrategyMetricSummary } from '../types'

export default function StrategyMetricsPanel({ scan }: { scan: Pick<ScanPanelState, 'error' | 'strategyMetricsLoading' | 'strategyLookbackDays' | 'setStrategyLookbackDays' | 'strategyCoverage' | 'strategyCoverageLoading' | 'conditionFilter' | 'activeStrategyMetricKey' | 'strategyMetricDisplay' | 'onStrategyMetricCardClick' | 'getStrategyMetricStatus'> }) {
  const {
    error,
    strategyMetricsLoading,
    strategyLookbackDays,
    setStrategyLookbackDays,
    strategyCoverage,
    strategyCoverageLoading,
    conditionFilter,
    activeStrategyMetricKey,
    strategyMetricDisplay,
    onStrategyMetricCardClick,
    getStrategyMetricStatus,
  } = scan
  return (
    <>
      {!error && !!activeStrategyMetricKey && (
        <div className="xls-scroll-frame scan-strategy-summary-frame" style={{ ['--xls-table-min-width' as any]: '1040px', marginTop: 6 }}>
          <table className="xls-table scan-strategy-summary-table" style={{ width: 'max-content', minWidth: '100%', tableLayout: 'auto' }}>
            <colgroup>
              <col style={{ width: 190 }} />
              <col style={{ width: 280 }} />
              <col style={{ width: 280 }} />
              <col style={{ width: 280 }} />
            </colgroup>
            <tbody>
              <tr className="xls-row xls-row--even">
                <td className="xls-cell" style={{ fontWeight: 700, color: 'var(--color-text-secondary)', fontSize: 11, overflow: 'visible' }}>
                  <div style={{ marginBottom: 4 }}>전략 성과({strategyLookbackDays}일)</div>
                  <div className="scan-cond-chips" style={{ gap: 2 }}>
                    {([30, 60, 120, 240] as StrategyLookbackDays[]).map((days) => (
                      <button
                        key={days}
                        type="button"
                        className={`tag${strategyLookbackDays === days ? ' active' : ''}`}
                        onClick={() => setStrategyLookbackDays(days)}
                        disabled={strategyMetricsLoading && strategyLookbackDays === days}
                      >
                        {days}D
                      </button>
                    ))}
                  </div>
                  {!!strategyCoverage?.alerts?.length && (
                    <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {strategyCoverage.alerts.slice(0, 2).map((alert, idx) => (
                        <span
                          key={`${idx}-${alert}`}
                          style={{
                            fontSize: 10,
                            color: 'var(--color-warning)',
                            background: 'var(--color-warning-bg)',
                            border: '1px solid var(--color-warning)',
                            borderRadius: 999,
                            padding: '1px 6px',
                            maxWidth: 182,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={alert}
                        >
                          백필 필요
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                {(strategyMetricsLoading
                  ? [
                    { key: 'day', label: '데이(당일)' },
                    { key: 'overnight', label: '오버나이트' },
                    { key: 'weekly', label: '주간(5거래일)' },
                  ]
                  : strategyMetricDisplay
                ).map((metric: any) => (
                  (() => {
                    const typedMetric = metric as StrategyMetricSummary
                    const status = getStrategyMetricStatus(typedMetric)
                    const coverage = strategyCoverage?.strategies?.[typedMetric.key]
                    const sampleProgressPct = coverage
                      ? Math.max(0, Math.min(100, (coverage.returnCount / Math.max(1, coverage.minRequired)) * 100))
                      : 0
                    const sampleStageLabel = coverage
                      ? coverage.hasEnoughSamples
                        ? '충분'
                        : sampleProgressPct >= 70
                          ? '축적중'
                          : '초기'
                      : '-'
                    const sampleDailyRate = coverage && strategyCoverage?.lookbackDays
                      ? coverage.returnCount / Math.max(1, strategyCoverage.lookbackDays)
                      : 0
                    const missingSamples = coverage
                      ? Math.max(0, coverage.minRequired - coverage.returnCount)
                      : 0
                    const expectedDaysToReady = coverage && !coverage.hasEnoughSamples && sampleDailyRate > 0
                      ? Math.ceil(missingSamples / sampleDailyRate)
                      : null
                    return (
                  <td
                    key={metric.key}
                    className="xls-cell"
                    role={strategyMetricsLoading ? undefined : 'button'}
                    tabIndex={strategyMetricsLoading ? -1 : 0}
                    aria-label={strategyMetricsLoading ? undefined : `${metric.label} 전략 필터 적용`}
                    aria-pressed={
                      !strategyMetricsLoading &&
                      conditionFilter === STRATEGY_FILTER_BY_METRIC_KEY[metric.key as StrategyMetricSummary['key']]
                    }
                    style={{
                      padding: '6px 8px',
                      cursor: strategyMetricsLoading ? 'default' : 'pointer',
                      background: !strategyMetricsLoading && conditionFilter === STRATEGY_FILTER_BY_METRIC_KEY[metric.key as StrategyMetricSummary['key']]
                        ? 'var(--color-brand-subtle)'
                        : undefined,
                    }}
                    onClick={() => { if (!strategyMetricsLoading) onStrategyMetricCardClick(metric.key as StrategyMetricSummary['key']) }}
                    onKeyDown={(event) => {
                      if (strategyMetricsLoading) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onStrategyMetricCardClick(metric.key as StrategyMetricSummary['key'])
                      }
                    }}
                    title={strategyMetricsLoading ? '' : '클릭하면 해당 전략 필터로 이동'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                        {metric.label}
                      </div>
                      {!strategyMetricsLoading && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 999,
                            color: status.textColor,
                            background: status.bgColor,
                            border: `1px solid ${status.textColor}`,
                            fontWeight: 700,
                          }}
                        >
                          {status.label}
                        </span>
                      )}
                    </div>
                    {strategyMetricsLoading ? (
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>집계 중…</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 2, fontSize: 11 }}>
                        <div style={{ color: 'var(--color-text-secondary)' }}>
                          거래 {formatNumber(metric.trades ?? 0, 0)}건 · 승률 {formatNumber(metric.winRatePct ?? 0, 1)}%
                        </div>
                        <div style={{ color: Number(metric.avgReturnPct ?? 0) >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)', fontWeight: 600 }}>
                          평균 {Number(metric.avgReturnPct ?? 0) > 0 ? '+' : ''}{formatNumber(metric.avgReturnPct ?? 0, 2)}%
                        </div>
                        <div style={{ color: Number(metric.sumReturnPct ?? 0) >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)' }}>
                          누적 {Number(metric.sumReturnPct ?? 0) > 0 ? '+' : ''}{formatNumber(metric.sumReturnPct ?? 0, 2)}%
                        </div>
                        <div style={{ color: 'var(--color-text-tertiary)' }}>
                          최고 {Number(metric.bestReturnPct ?? 0) > 0 ? '+' : ''}{formatNumber(metric.bestReturnPct ?? 0, 2)}% ·
                          최저 {Number(metric.worstReturnPct ?? 0) > 0 ? '+' : ''}{formatNumber(metric.worstReturnPct ?? 0, 2)}%
                        </div>
                        <div style={{ color: coverage && !coverage.hasEnoughSamples ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }}>
                          {strategyCoverageLoading
                            ? '커버리지 집계 중…'
                            : coverage
                              ? `커버리지 ${formatNumber(coverage.coveragePct, 1)}% · 표본 ${formatNumber(coverage.returnCount, 0)}/${formatNumber(coverage.minRequired, 0)}`
                              : '커버리지 정보 없음'}
                        </div>
                        <div style={{ color: 'var(--color-text-tertiary)' }}>
                          {strategyCoverageLoading
                            ? '표본 진행상태 계산 중…'
                            : coverage
                              ? `신호 ${formatNumber(coverage.signalCount, 0)}건 · 유효수익 ${formatNumber(coverage.returnCount, 0)}건 · ${coverage.hasEnoughSamples ? '의미 기준 충족' : `기준까지 ${formatNumber(Math.max(0, coverage.minRequired - coverage.returnCount), 0)}건`}`
                              : '표본 진행상태 정보 없음'}
                        </div>
                        <div style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>
                          {strategyCoverageLoading
                            ? '충족 시점 추정 중…'
                            : coverage
                              ? coverage.hasEnoughSamples
                                ? '표본 기준 이미 충족됨'
                                : expectedDaysToReady != null && Number.isFinite(expectedDaysToReady)
                                  ? `최근 ${formatNumber(strategyCoverage?.lookbackDays ?? 0, 0)}일 적재 속도 기준, 예상 D+${formatNumber(expectedDaysToReady, 0)}`
                                  : '충족 시점 추정 불가 (표본 축적 필요)'
                              : '충족 시점 정보 없음'}
                        </div>
                        <div style={{ display: 'grid', gap: 2, marginTop: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--color-text-tertiary)', fontSize: 10, gap: 6, flexWrap: 'wrap' }}>
                            <span>표본 진행률</span>
                            <span>{strategyCoverageLoading ? '-' : `${formatNumber(sampleProgressPct, 0)}% · ${sampleStageLabel}`}</span>
                          </div>
                          <div style={{ height: 4, borderRadius: 999, background: 'var(--color-border-subtle)', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${strategyCoverageLoading ? 0 : sampleProgressPct}%`,
                                height: '100%',
                                background: coverage?.hasEnoughSamples ? 'var(--color-stock-up)' : 'var(--color-warning)',
                                transition: 'width 0.35s ease',
                              }}
                            />
                          </div>
                        </div>
                        <div className="scan-strategy-sparkline-wrap" aria-label="최근 20신호 수익률 추이">
                          <StrategySparkline values={Array.isArray(typedMetric.recentReturns20) ? typedMetric.recentReturns20 : []} />
                        </div>
                      </div>
                    )}
                  </td>
                    )
                  })()
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
