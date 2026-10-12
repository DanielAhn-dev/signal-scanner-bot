import React from 'react'
import { pct } from '../lib/format'
import { signalCls } from '../lib/signal'
import type { BacktestResponse, BacktestRiser } from '../types'
import type { SortKey } from '../lib/backtestView'

export type SamplesTabProps = {
  data: BacktestResponse
  selectStock: (stock: { code: string; name: string }) => void
  sorted: BacktestRiser[]
  toggleSort: (key: SortKey) => void
  sortIcon: (key: SortKey) => React.ReactNode
}

export default function SamplesTab({
  data,
  selectStock,
  sorted,
  toggleSort,
  sortIcon,
}: SamplesTabProps) {
  return (
    <div className="bt-section">
      <div className="bt-section-title">급등 이벤트 샘플</div>
      {sorted.length === 0 ? (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
          조건에 맞는 급등 이벤트가 없습니다. 기간/기준을 완화해 보세요.
        </p>
      ) : (
        <div className="mobile-card-table" style={{ overflowX: 'auto', margin: '0 calc(-1 * var(--space-4))' }}>
          <table className="bt-table" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>종목</th>
                <th data-sortable onClick={() => toggleSort('asof')} style={{ textAlign: 'left' }}>
                  기준일{sortIcon('asof')}
                </th>
                <th data-sortable onClick={() => toggleSort('forwardReturnPct')} style={{ textAlign: 'right' }}>
                  Horizon 수익률{sortIcon('forwardReturnPct')}
                </th>
                <th data-sortable onClick={() => toggleSort('totalScore')} style={{ textAlign: 'right' }}>
                  점수{sortIcon('totalScore')}
                </th>
                <th>시그널</th>
                <th data-sortable onClick={() => toggleSort('rsi14')} style={{ textAlign: 'right' }}>
                  RSI14{sortIcon('rsi14')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={`${row.code}-${row.asof}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() =>
                    selectStock({ code: row.code, name: row.name || row.code })
                  }
                  title={`${row.name || row.code} 패턴 점검`}
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
      )}
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 'var(--space-3) 0 0' }}>
        종목 클릭 시 종목 점검 탭에 자동 입력됩니다.
      </p>
    </div>
  )
}
