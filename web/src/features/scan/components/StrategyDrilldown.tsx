import { formatNumber } from '../../../lib/format'
import type { ScanPanelState } from '../types'

export default function StrategyDrilldown({ scan }: { scan: Pick<ScanPanelState, 'error' | 'strategyLookbackDays' | 'strategyDrilldown' | 'strategyDrilldownLoading' | 'strategyDrilldownError' | 'activeStrategyMetricKey' | 'activeStrategyMetric'> }) {
  const {
    error,
    strategyLookbackDays,
    strategyDrilldown,
    strategyDrilldownLoading,
    strategyDrilldownError,
    activeStrategyMetricKey,
    activeStrategyMetric,
  } = scan
  return (
    <>
      {!error && activeStrategyMetricKey && (
        <div className="xls-scroll-frame scan-strategy-drilldown" style={{ ['--xls-table-min-width' as any]: '680px', marginTop: 6 }}>
          <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <tbody>
              <tr className="xls-row xls-row--even">
                <td className="xls-cell" colSpan={5} style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                  전략 근거 리스트 · {activeStrategyMetric?.label ?? '선택 전략'} · 최근 {strategyLookbackDays}일
                </td>
              </tr>
              <tr className="xls-row">
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>날짜</td>
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>종목코드</td>
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>종목명</td>
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>전략</td>
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>수익률</td>
              </tr>
              {strategyDrilldownLoading && (
                <tr className="xls-row xls-row--even">
                  <td className="xls-cell" colSpan={5} style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>근거 데이터를 불러오는 중…</td>
                </tr>
              )}
              {!strategyDrilldownLoading && strategyDrilldownError && (
                <tr className="xls-row xls-row--even">
                  <td className="xls-cell" colSpan={5} style={{ fontSize: 11, color: 'var(--color-stock-down)' }}>{strategyDrilldownError}</td>
                </tr>
              )}
              {!strategyDrilldownLoading && !strategyDrilldownError && strategyDrilldown.length === 0 && (
                <tr className="xls-row xls-row--even">
                  <td className="xls-cell" colSpan={5} style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>표시할 근거 데이터가 없습니다.</td>
                </tr>
              )}
              {!strategyDrilldownLoading && !strategyDrilldownError && strategyDrilldown.map((row, idx) => (
                <tr key={`${row.strategyKey}-${row.code}-${row.tradeDate}-${idx}`} className={`xls-row${idx % 2 === 1 ? ' xls-row--even' : ''}`}>
                  <td className="xls-cell" style={{ fontSize: 11 }}>{row.tradeDate}</td>
                  <td className="xls-cell" style={{ fontSize: 11, fontFamily: 'var(--font-family-mono)' }}>{row.code}</td>
                  <td className="xls-cell" style={{ fontSize: 11 }}>{row.name}</td>
                  <td className="xls-cell" style={{ fontSize: 11 }}>{row.strategyLabel}</td>
                  <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600, color: typeof row.returnPct === 'number' ? (row.returnPct >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)') : 'var(--color-text-tertiary)' }}>
                    {typeof row.returnPct === 'number'
                      ? `${row.returnPct > 0 ? '+' : ''}${formatNumber(row.returnPct, 2)}%`
                      : '대기중'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
