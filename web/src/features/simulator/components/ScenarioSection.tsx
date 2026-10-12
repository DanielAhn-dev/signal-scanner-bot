import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import Detail from '../../../components/ui/Detail'
import type { calcSummary, calcScenarioRows } from '../lib/summary'

export type ScenarioSectionProps = {
  summary: ReturnType<typeof calcSummary>
  scenarioRows: ReturnType<typeof calcScenarioRows>
}

export default function ScenarioSection({
  summary,
  scenarioRows,
}: ScenarioSectionProps) {
  return (
    <div className="sim-section">
      <span className="sim-section-label">시나리오 분석</span>
      <Detail><p className="sim-section-desc">체결 반영 투자금 기준 · 수수료·세금 차감 순수익</p></Detail>

      <div className="sim-scenario-table-wrap">
        <table className="sim-scenario-table">
          <thead>
            <tr>
              <th className="sim-scenario-th">시나리오</th>
              <th className="sim-scenario-th">순수익</th>
              <th className="sim-scenario-th sim-scenario-th--hide-sm">수익률(투자금 대비)</th>
            </tr>
          </thead>
          <tbody>
            {/* 최대 손실 */}
            <tr className="sim-scenario-row sim-scenario-row--special">
              <td className="sim-scenario-td">
                <span className="sim-scenario-badge sim-scenario-badge--down">전량 손절</span>
              </td>
              <td className="sim-scenario-td sim-neg sim-scenario-amount">{formatKrw(summary.maxLoss)}</td>
              <td className="sim-scenario-td sim-neg sim-scenario-th--hide-sm">
                {summary.allocated > 0 ? formatNumber((summary.maxLoss / summary.allocated) * 100, 2) : '—'}%
              </td>
            </tr>
            {scenarioRows.map((row) => {
              const isPos = row.net >= 0
              return (
                <tr key={row.pct} className={`sim-scenario-row${row.pct === 0 ? ' sim-scenario-row--zero' : ''}`}>
                  <td className="sim-scenario-td">
                    <span className={`sim-scenario-badge${isPos ? ' sim-scenario-badge--up' : ' sim-scenario-badge--down'}`}>
                      {row.pct > 0 ? '+' : ''}{row.pct}%
                    </span>
                  </td>
                  <td className={`sim-scenario-td sim-scenario-amount${isPos ? ' sim-pos' : ' sim-neg'}`}>
                    {isPos ? '+' : ''}{formatKrw(row.net)}
                  </td>
                  <td className={`sim-scenario-td sim-scenario-th--hide-sm${isPos ? ' sim-pos' : ' sim-neg'}`}>
                    {summary.allocated > 0 ? `${isPos ? '+' : ''}${formatNumber((row.net / summary.allocated) * 100, 2)}%` : '—'}
                  </td>
                </tr>
              )
            })}
            <Detail>
            {/* 기대값 행 */}
            <tr className="sim-scenario-row sim-scenario-row--special sim-scenario-row--ev">
              <td className="sim-scenario-td">
                <span className="sim-scenario-badge sim-scenario-badge--ev">기대값</span>
              </td>
              <td className={`sim-scenario-td sim-scenario-amount${summary.evAfterCost >= 0 ? ' sim-pos' : ' sim-neg'}`}>
                {summary.evAfterCost >= 0 ? '+' : ''}{formatKrw(summary.evAfterCost)}
              </td>
              <td className={`sim-scenario-td sim-scenario-th--hide-sm${summary.evAfterCost >= 0 ? ' sim-pos' : ' sim-neg'}`}>
                {summary.allocated > 0 ? `${summary.evAfterCost >= 0 ? '+' : ''}${formatNumber((summary.evAfterCost / summary.allocated) * 100, 2)}%` : '—'}
              </td>
            </tr>
            </Detail>
          </tbody>
        </table>
      </div>
    </div>
  )
}
