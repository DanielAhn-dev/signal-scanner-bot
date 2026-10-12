import React from 'react'
import Skeleton from '../../../components/Skeleton'
import { buildLinePath, formatKrwShort } from '../lib/chartMath'
import { formatTriggerLabel } from '../lib/labels'
import { COLOR_NEGATIVE, COLOR_POSITIVE, COLOR_WARNING } from '../constants'
import type { AdaptiveInsights, DecisionRow } from '../types'
import type { summarizeDecisions } from '../lib/decisionSummary'
import type { GrowthEvent } from '../lib/growthTimeline'
import type { buildProfitTrend } from '../lib/profitTrend'
import type { buildRollingWinRate } from '../lib/rollingWinRate'

export type GrowthTabProps = {
  rows: DecisionRow[]
  decLoading: boolean
  activityLoading: boolean
  adaptiveInsights: AdaptiveInsights | null
  adaptiveLoading: boolean
  summary: ReturnType<typeof summarizeDecisions>
  growthTimeline: GrowthEvent[]
  profitTrend: ReturnType<typeof buildProfitTrend>
  rollingWinRate: ReturnType<typeof buildRollingWinRate>
}

export default function GrowthTab({
  rows,
  decLoading,
  activityLoading,
  adaptiveInsights,
  adaptiveLoading,
  summary,
  growthTimeline,
  profitTrend,
  rollingWinRate,
}: GrowthTabProps) {
  return (
    <>
      <div className="card mb-4" style={{ borderLeft: '4px solid var(--color-brand)' }}>
        <div className="title-md" style={{ marginBottom: 8 }}>전략 성장 요약</div>
        {decLoading && <Skeleton lines={3} height={12} />}
        {!decLoading && rows.length > 0 && (() => {
          const firstDate = rows[rows.length - 1]?.created_at ? new Date(rows[rows.length - 1]!.created_at!).toLocaleDateString('ko-KR') : '-'
          const lastDate = rows[0]?.created_at ? new Date(rows[0]!.created_at!).toLocaleDateString('ko-KR') : '-'
          const uniqueRegimes = new Set(rows.map((row) => row.market_regime).filter(Boolean)).size
          const uniqueVersions = new Set(rows.map((row) => row.strategy_version).filter(Boolean)).size
          return (
            <div style={{ lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>
              <span>{firstDate}</span>부터 <span>{lastDate}</span>까지 <strong style={{ color: 'var(--color-text-primary)' }}>{summary.total}건</strong>의 의사결정이 누적되었습니다. 이 중 자동 시스템이 판단한 비중은 <strong style={{ color: 'var(--color-brand)' }}>{summary.autoRatio}%</strong>이며, <strong>{summary.buyCount}번</strong> 매수, <strong>{summary.sellCount}번</strong> 매도가 이루어졌습니다.
              {uniqueVersions > 0 && <> 총 <strong>{uniqueVersions}개</strong>의 전략 버전이 관측되었고,</>}
              {uniqueRegimes > 0 && <> <strong>{uniqueRegimes}가지</strong> 시장 국면을 경험했습니다.</>}
              {' '}주요 판단 트리거는 <strong>{formatTriggerLabel(summary.topTriggers[0]?.[0] || '-')}</strong>{summary.topTriggers[0] ? `(${summary.topTriggers[0][1]}건)` : ''}입니다.
            </div>
          )
        })()}
        {!decLoading && rows.length === 0 && <div className="muted">아직 데이터가 없습니다. 자동매매가 실행되면 기록이 쌓입니다.</div>}
      </div>

      {!adaptiveLoading && adaptiveInsights && (
        <div className="card mb-4">
          <div className="title-md" style={{ marginBottom: 8 }}>실시간 적응 메모</div>
          <div style={{ lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>
            최근 {adaptiveInsights.sampleCount}개 샘플을 기준으로 <strong style={{ color: 'var(--color-text-primary)' }}>{adaptiveInsights.todayBiasSummary}</strong> 패턴이 상대적으로 우세합니다. 현재 엔진은 상위 강화 기준을 스캔/하이라이트 정렬에 반영하고 있으며, 최근 {adaptiveInsights.horizonBars}거래일 평균 성과는 <strong style={{ color: adaptiveInsights.baseAvgReturnPct >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE }}>{adaptiveInsights.baseAvgReturnPct > 0 ? '+' : ''}{adaptiveInsights.baseAvgReturnPct}%</strong>, 적중률은 <strong style={{ color: 'var(--color-text-primary)' }}>{adaptiveInsights.baseHitRatePct}%</strong>입니다.
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div>
            <div className="title-md">실현손익 추이</div>
            <div className="muted" style={{ marginTop: 4, fontSize: 'var(--font-size-sm)' }}>최근 매도 거래를 기준으로 누적 실현손익 흐름을 단순 선형 차트로 보여줍니다.</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="caption">현재 누적 실현손익</div>
            <div className="title-md" style={{ color: profitTrend.lastValue >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE }}>{formatKrwShort(profitTrend.lastValue)}</div>
          </div>
        </div>
        {activityLoading && <Skeleton lines={4} height={12} />}
        {!activityLoading && profitTrend.points.length === 0 && <div className="muted">실현손익 차트를 그릴 매도 데이터가 아직 없습니다.</div>}
        {!activityLoading && profitTrend.points.length > 0 && (
          <div>
            <svg viewBox="0 0 560 168" style={{ maxWidth: 720, width: '100%', height: 'auto', display: 'block', marginLeft: 'auto', marginRight: 'auto' }} aria-label="실현손익 추이 차트" role="img">
              {/* 구간별 배경색 */}
              {profitTrend.fillSegments.map((seg, idx) => {
                if (profitTrend.points.length < 2) return null
                const p1 = profitTrend.points[seg.start]
                const p2 = profitTrend.points[seg.end]
                if (!p1 || !p2) return null
                return (
                  <rect
                    key={`fill-${idx}`}
                    x={Math.min(p1.x, p2.x) - 2}
                    y="12"
                    width={Math.abs(p2.x - p1.x) + 4}
                    height="144"
                    fill={seg.color}
                    opacity="0.4"
                  />
                )
              })}
              {/* 기준선 */}
              <line x1="18" x2="542" y1={profitTrend.baselineY} y2={profitTrend.baselineY} stroke="var(--color-border-subtle)" strokeDasharray="4 4" strokeWidth="0.8" />
              {/* 이동평균선 (회색 점선) */}
              <path
                d={profitTrend.maPath}
                fill="none"
                stroke="var(--chart-ma-line)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="4 2"
              />
              {/* 예상 추세선 (보라색 점선) */}
              {profitTrend.projectionPoints.length > 0 && (
                <path
                  d={buildLinePath([profitTrend.points[profitTrend.points.length - 1]!, ...profitTrend.projectionPoints])}
                  fill="none"
                  stroke="var(--chart-projection-line)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="5 4"
                />
              )}
              {/* 구간별 색상 세그먼트 메인 라인 */}
              {profitTrend.segments.map((seg, idx) => (
                <line
                  key={`seg-${idx}`}
                  x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}
                  stroke={seg.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              ))}
              {/* 데이터 포인트 (개별 색상) */}
              {profitTrend.points.map((point) => (
                <g key={point.id}>
                  <circle cx={point.x} cy={point.y} r="4" fill="white" stroke={point.value >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE} strokeWidth="2" style={{ cursor: 'pointer' }} />
                  <title>{`${point.label} · ${point.date} · ${formatKrwShort(point.value)}`}</title>
                </g>
              ))}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              <span>{profitTrend.points[0]?.date || '-'}</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span style={{ display: 'inline-block', width: 14, height: 3, background: COLOR_POSITIVE, borderRadius: 2 }} /> 실현손익</span>
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--chart-ma-line)', backgroundImage: 'repeating-linear-gradient(90deg, var(--chart-ma-line) 0px, var(--chart-ma-line) 4px, transparent 4px, transparent 6px)' }} /> 이동평균</span>
                {profitTrend.projectionPoints.length > 0 && <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--chart-projection-line)', backgroundImage: 'repeating-linear-gradient(90deg, var(--chart-projection-line) 0px, var(--chart-projection-line) 5px, transparent 5px, transparent 9px)' }} /> 예상 추세</span>}
              </span>
              <span>{profitTrend.points[profitTrend.points.length - 1]?.date || '-'}</span>
            </div>
          </div>
        )}
      </div>

      {!activityLoading && profitTrend.tradeBars.length > 0 && (
        <div className="card mb-4">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div>
              <div className="title-md">거래별 손익 분포</div>
              <div className="muted" style={{ marginTop: 4, fontSize: 'var(--font-size-sm)' }}>각 매도 거래의 개별 실현손익. 초록=수익, 빨강=손실</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="caption">전체 승률</div>
              <div className="title-md" style={{ color: profitTrend.tradeBars.filter((b) => b.isPositive).length / profitTrend.tradeBars.length >= 0.5 ? COLOR_POSITIVE : COLOR_NEGATIVE }}>
                {Math.round((profitTrend.tradeBars.filter((b) => b.isPositive).length / profitTrend.tradeBars.length) * 100)}%
              </div>
            </div>
          </div>
          <svg viewBox="0 0 560 80" style={{ width: '100%', height: 'auto', display: 'block' }} aria-label="거래별 손익 바 차트">
            <line x1="10" x2="550" y1="44" y2="44" stroke="var(--color-border-subtle)" strokeWidth="0.8" />
            {profitTrend.tradeBars.map((bar, idx) => (
              <g key={idx}>
                <rect
                  x={bar.x - bar.barW / 2}
                  y={bar.rectY}
                  width={bar.barW}
                  height={bar.barH}
                  fill={bar.isPositive ? COLOR_POSITIVE : COLOR_NEGATIVE}
                  opacity="0.8"
                  rx="2"
                />
                <title>{`${bar.label} · ${bar.date} · ${formatKrwShort(bar.amount)}`}</title>
              </g>
            ))}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
            <span>{profitTrend.tradeBars[0]?.date || '-'}</span>
            <span>{profitTrend.tradeBars[profitTrend.tradeBars.length - 1]?.date || '-'}</span>
          </div>
        </div>
      )}

      {!activityLoading && rollingWinRate.points.length > 0 && (
        <div className="card mb-4">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div>
              <div className="title-md">롤링 승률 추이</div>
              <div className="muted" style={{ marginTop: 4, fontSize: 'var(--font-size-sm)' }}>최근 거래 묶음 기준 승률 변화. 50% 위면 수익 우세</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="caption">평균 승률</div>
              <div className="title-md" style={{ color: rollingWinRate.avgWinRate >= 50 ? COLOR_POSITIVE : COLOR_NEGATIVE }}>{rollingWinRate.avgWinRate}%</div>
            </div>
          </div>
          <svg viewBox="0 0 560 60" style={{ width: '100%', height: 'auto', display: 'block' }} aria-label="롤링 승률 차트">
            <line x1="18" x2="542" y1="30" y2="30" stroke="var(--color-border-subtle)" strokeDasharray="4 4" strokeWidth="0.8" />
            <path
              d={rollingWinRate.path}
              fill="none"
              stroke={rollingWinRate.avgWinRate >= 50 ? COLOR_POSITIVE : COLOR_NEGATIVE}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {rollingWinRate.points.map((pt, idx) => (
              <g key={idx}>
                <circle cx={pt.x} cy={pt.y} r="3.5" fill="white" stroke={pt.winRate >= 50 ? COLOR_POSITIVE : COLOR_NEGATIVE} strokeWidth="1.5" />
                <title>{`승률 ${pt.winRate}%`}</title>
              </g>
            ))}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
            <span style={{ color: COLOR_POSITIVE }}>↑ 수익 우세</span>
            <span>50% 기준선</span>
            <span style={{ color: COLOR_NEGATIVE }}>손실 우세 ↓</span>
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>전략 & 국면 전환 타임라인</div>
        <div className="muted" style={{ marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>전략 버전 또는 시장 국면이 바뀐 시점을 시간 순으로 표시합니다.</div>
        {decLoading && <Skeleton lines={5} height={12} />}
        {!decLoading && growthTimeline.length === 0 && <div className="muted">감지된 전환 없음</div>}
        {!decLoading && growthTimeline.map((item) => (
          <div
            key={item.key}
            style={{
              display: 'flex',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px solid var(--color-border-subtle)',
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: item.kind === 'version' ? 'var(--color-brand)' : COLOR_WARNING,
                marginTop: 4,
                flexShrink: 0,
              }}
            />
            <div>
              <div style={{ fontWeight: 500 }}>{item.text}</div>
              <div className="caption" style={{ marginTop: 2 }}>{item.subtitle}</div>
              <div className="muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 2 }}>{item.time}</div>
            </div>
          </div>
        ))}
      </div>

      {!decLoading && summary.topTriggers.length > 0 && (
        <div className="card">
          <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>누적 트리거 분포</div>
          <div className="muted" style={{ marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>어떤 조건에 의해 매매가 결정되었는지 누적 빈도를 보여줍니다.</div>
          {summary.topTriggers.map(([trigger, count]) => {
            const maxCount = summary.topTriggers[0]?.[1] ?? 1
            const pct = Math.round((count / maxCount) * 100)
            return (
              <div key={trigger} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{formatTriggerLabel(trigger)}</span>
                  <span className="caption">{count}건 ({Math.round((count / summary.total) * 100)}%)</span>
                </div>
                <div style={{ height: 8, background: 'var(--color-border-subtle)', borderRadius: 4 }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: 'var(--color-brand)',
                      borderRadius: 4,
                      transition: 'width 0.5s',
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
