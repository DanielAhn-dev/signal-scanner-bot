import React from 'react'
import { LayoutDashboard, TrendingUp, Flag, Activity } from 'lucide-react'
import { formatKrw, formatNumber } from '../../../lib/format'
import CandleChart from '../../../components/CandleChart'
import { DIVIDER } from './Divider'
import { regimeLabel } from '../lib/styles'
import type { OhlcvCandle } from '../../../lib/types'
import type { calcChartHud } from '../lib/candles'

export type CandleSectionProps = {
  advisor: any
  candles: OhlcvCandle[]
  chartHud: ReturnType<typeof calcChartHud>
  signalText: string
  showChartHud: boolean
  setShowChartHud: React.Dispatch<React.SetStateAction<boolean>>
  showMaEmaOverlay: boolean
  setShowMaEmaOverlay: React.Dispatch<React.SetStateAction<boolean>>
  showTradeMarkers: boolean
  setShowTradeMarkers: React.Dispatch<React.SetStateAction<boolean>>
  showForceLine: boolean
  setShowForceLine: React.Dispatch<React.SetStateAction<boolean>>
}

export default function CandleSection({
  advisor,
  candles,
  chartHud,
  signalText,
  showChartHud,
  setShowChartHud,
  showMaEmaOverlay,
  setShowMaEmaOverlay,
  showTradeMarkers,
  setShowTradeMarkers,
  showForceLine,
  setShowForceLine,
}: CandleSectionProps) {
  return (
    <>
        {candles.length > 0 && (
          <>
            {DIVIDER}
            <div className="analyze-section-head" style={{ marginBottom: 'var(--space-2)', alignItems: 'flex-start' }}>
              <div className="analyze-section-head__title">
                <div className="title-md">가격 차트</div>
              </div>
              <div className="analyze-chart-toolbar">
                <button
                  className="analyze-chart-toggle"
                  type="button"
                  onClick={() => setShowChartHud((v) => !v)}
                  aria-pressed={showChartHud}
                  title="HUD"
                  data-tone="info"
                  data-active={showChartHud}
                >
                  <span className="analyze-chart-toggle__icon">
                    <LayoutDashboard size={14} />
                  </span>
                  <span className="analyze-chart-toggle__label">
                    HUD
                  </span>
                </button>
                <button
                  className="analyze-chart-toggle"
                  type="button"
                  onClick={() => setShowMaEmaOverlay((v) => !v)}
                  aria-pressed={showMaEmaOverlay}
                  title="EMA21/SMA50/SMA200"
                  data-tone="warning"
                  data-active={showMaEmaOverlay}
                >
                  <span className="analyze-chart-toggle__icon">
                    <TrendingUp size={14} />
                  </span>
                  <span className="analyze-chart-toggle__label">
                    MA
                  </span>
                </button>
                <button
                  className="analyze-chart-toggle"
                  type="button"
                  onClick={() => setShowTradeMarkers((v) => !v)}
                  aria-pressed={showTradeMarkers}
                  title="신호 마커"
                  data-tone="success"
                  data-active={showTradeMarkers}
                >
                  <span className="analyze-chart-toggle__icon">
                    <Flag size={14} />
                  </span>
                  <span className="analyze-chart-toggle__label">
                    마커
                  </span>
                </button>
                <button
                  className="analyze-chart-toggle"
                  type="button"
                  onClick={() => setShowForceLine((v) => !v)}
                  aria-pressed={showForceLine}
                  title="세력선"
                  data-tone="teal"
                  data-active={showForceLine}
                >
                  <span className="analyze-chart-toggle__icon">
                    <Activity size={14} />
                  </span>
                  <span className="analyze-chart-toggle__label">
                    세력
                  </span>
                </button>
              </div>
            </div>
            {showChartHud && (
              <div className="cards-grid cols-3" style={{ marginBottom: 'var(--space-3)' }}>
                {([
                  ['신호', signalText],
                  ['1단계 레짐', regimeLabel(advisor?.twoStage?.regime)],
                  ['2단계 실행', advisor?.twoStage?.actionLabel ?? '—'],
                  ['지지선 (최근 20봉 최저)', chartHud.support != null ? formatKrw(chartHud.support) : '—'],
                  ['저항선 (최근 20봉 최고)', chartHud.resistance != null ? formatKrw(chartHud.resistance) : '—'],
                  ['권장 비중', advisor?.twoStage?.allocationPct != null ? `${formatNumber(advisor.twoStage.allocationPct, 0)}%` : '—'],
                  ['손절', advisor?.stopPrice != null ? formatKrw(advisor.stopPrice) : '—'],
                  ['1차 익절', advisor?.target1 != null ? formatKrw(advisor.target1) : '—'],
                  ['진입구간', advisor?.entryLow != null && advisor?.entryHigh != null ? `${formatKrw(advisor.entryLow)} ~ ${formatKrw(advisor.entryHigh)}` : '—'],
                ] as [string, string][]).map(([label, val]) => (
                  <div key={label}>
                    <div className="stat-label">{label}</div>
                    <div className="stat-value" style={{ fontSize: 'var(--font-size-base)', color: val === '—' ? 'var(--color-text-disabled)' : undefined }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
            <CandleChart
              candles={candles}
              entryLow={showChartHud ? advisor?.entryLow : null}
              entryHigh={showChartHud ? advisor?.entryHigh : null}
              stopLoss={showChartHud ? advisor?.stopPrice : null}
              target1={showChartHud ? advisor?.target1 : null}
              tradeSignal={advisor?.status ?? null}
              showMaEmaOverlay={showMaEmaOverlay}
              showTradeMarkers={showTradeMarkers}
              showForceLine={showForceLine}
              support={chartHud?.support ?? null}
              resistance={chartHud?.resistance ?? null}
            />
          </>
        )}
    </>
  )
}
