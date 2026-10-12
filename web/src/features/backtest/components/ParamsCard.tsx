import React from 'react'
import type { Horizon } from '../constants'

export type ParamsCardProps = {
  horizon: Horizon
  setHorizon: React.Dispatch<React.SetStateAction<Horizon>>
  lookbackDays: number
  setLookbackDays: React.Dispatch<React.SetStateAction<number>>
  rallyPct: number
  setRallyPct: React.Dispatch<React.SetStateAction<number>>
  topN: number
  setTopN: React.Dispatch<React.SetStateAction<number>>
  visibleHorizons: Horizon[]
  hasExtendedHorizon: boolean
}

export default function ParamsCard({
  horizon,
  setHorizon,
  lookbackDays,
  setLookbackDays,
  rallyPct,
  setRallyPct,
  topN,
  setTopN,
  visibleHorizons,
  hasExtendedHorizon,
}: ParamsCardProps) {
  return (
    <div className="bt-params-card">
      <div className="bt-params-grid">
        <div className="bt-param-group">
          <span className="bt-param-label">Horizon</span>
          <div className="bt-horizon-tabs">
            {visibleHorizons.map((h) => (
              <button
                key={h}
                className={`bt-horizon-tab${horizon === h ? ' bt-horizon-tab--active' : ''}`}
                onClick={() => setHorizon(h)}
              >
                {h}일
              </button>
            ))}
          </div>
        </div>
        <div className="bt-param-group">
          <span className="bt-param-label">탐색 기간(일)</span>
          <div className="sim-input-row">
            <input
              className="sim-input"
              type="number"
              min={60}
              max={365}
              value={lookbackDays}
              onChange={(e) =>
                setLookbackDays(Math.max(60, Math.min(365, Number(e.target.value) || 60)))
              }
            />
            <span className="sim-input-suffix">일</span>
          </div>
        </div>
        <div className="bt-param-group">
          <span className="bt-param-label">급등 기준(%)</span>
          <div className="sim-input-row">
            <input
              className="sim-input"
              type="number"
              min={5}
              max={80}
              value={rallyPct}
              onChange={(e) =>
                setRallyPct(Math.max(5, Math.min(80, Number(e.target.value) || 5)))
              }
            />
            <span className="sim-input-suffix">%</span>
          </div>
        </div>
        <div className="bt-param-group">
          <span className="bt-param-label">표본 수(top N)</span>
          <div className="sim-input-row">
            <input
              className="sim-input"
              type="number"
              min={5}
              max={100}
              value={topN}
              onChange={(e) =>
                setTopN(Math.max(5, Math.min(100, Number(e.target.value) || 5)))
              }
            />
          </div>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 'var(--space-3) 0 0', lineHeight: 1.5 }}>
        {hasExtendedHorizon
          ? '※ 90일·120일은 데이터가 확인된 경우에만 자동으로 노출됩니다.'
          : '※ 기본 표시 Horizon은 20·40·60일이며, 90·120일은 데이터가 확인되면 자동 표시됩니다.'}
      </p>
    </div>
  )
}
