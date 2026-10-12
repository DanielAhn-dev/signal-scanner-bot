import type { ScanPanelState } from '../types'

export default function StrategyGuideCard({ scan }: { scan: Pick<ScanPanelState, 'error' | 'activeStrategyGuide' | 'activeStrategyStatus' | 'activeStrategyPositionText' | 'activeStrategyBackfillGuard'> }) {
  const {
    error,
    activeStrategyGuide,
    activeStrategyStatus,
    activeStrategyPositionText,
    activeStrategyBackfillGuard,
  } = scan
  return (
    <>
      {!error && activeStrategyGuide && (
        <div className="xls-scroll-frame" style={{ ['--xls-table-min-width' as any]: '680px', marginTop: 6 }}>
          <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '78%' }} />
            </colgroup>
            <tbody>
              <tr className="xls-row xls-row--even">
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-brand)' }}>
                  {activeStrategyGuide.title}
                </td>
                <td className="xls-cell" style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  실전 감산 규칙: 양호 1.0R · 주의 0.7R · 경고 0.5R
                  {activeStrategyStatus && (
                    <span style={{ marginLeft: 8, color: activeStrategyStatus.textColor, fontWeight: 700 }}>
                      현재 상태 {activeStrategyStatus.label}
                    </span>
                  )}
                  {activeStrategyBackfillGuard && (
                    <span style={{ marginLeft: 8, color: 'var(--color-warning)', fontWeight: 700 }}>
                      {activeStrategyBackfillGuard}
                    </span>
                  )}
                </td>
              </tr>
              <tr className="xls-row">
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>진입</td>
                <td className="xls-cell" style={{ fontSize: 11 }}>{activeStrategyGuide.entry}</td>
              </tr>
              <tr className="xls-row xls-row--even">
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>포지션</td>
                <td className="xls-cell" style={{ fontSize: 11 }}>
                  {activeStrategyGuide.positionSize}
                  {activeStrategyPositionText && (
                    <span style={{ marginLeft: 8, color: 'var(--color-brand)', fontWeight: 600 }}>
                      {activeStrategyPositionText}
                    </span>
                  )}
                </td>
              </tr>
              <tr className="xls-row">
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>보유</td>
                <td className="xls-cell" style={{ fontSize: 11 }}>{activeStrategyGuide.holding}</td>
              </tr>
              <tr className="xls-row xls-row--even">
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>손절</td>
                <td className="xls-cell" style={{ fontSize: 11, color: 'var(--color-stock-down)' }}>{activeStrategyGuide.stopLoss}</td>
              </tr>
              <tr className="xls-row">
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>익절</td>
                <td className="xls-cell" style={{ fontSize: 11, color: 'var(--color-stock-up)' }}>{activeStrategyGuide.takeProfit}</td>
              </tr>
              <tr className="xls-row xls-row--even">
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>강제청산</td>
                <td className="xls-cell" style={{ fontSize: 11 }}>{activeStrategyGuide.forceExit}</td>
              </tr>
              <tr className="xls-row">
                <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>주의</td>
                <td className="xls-cell" style={{ fontSize: 11 }}>{activeStrategyGuide.caution}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
