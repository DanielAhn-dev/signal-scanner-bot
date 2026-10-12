import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import { formatDateTime } from '../lib/dates'

export type ResultHeadProps = {
  result: any
}

export default function ResultHead({
  result,
}: ResultHeadProps) {
  return (
      <table className="xls-table analyze-sheet__result-head" style={{ width: '100%', tableLayout: 'fixed', marginBottom: 'var(--space-4)' }}>
        <colgroup>
          <col style={{ width: '22%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '20%' }} />
        </colgroup>
        <tbody>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={3} style={{ fontSize: 18, fontWeight: 700 }}>
              {result.name ?? result.code}
            </td>
            <td className="xls-cell" colSpan={2} style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums' }}>
                {result.close != null ? formatKrw(result.close) : '—'}
              </div>
              {result.change_pct != null && (
                <div className={result.change_pct > 0 ? 'positive' : result.change_pct < 0 ? 'negative' : 'neutral'}>
                  {result.change_pct > 0 ? '+' : ''}{formatNumber(result.change_pct, 2)}%
                </div>
              )}
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" colSpan={5} style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>
              {result.code} · {result.price_source === 'realtime'
                ? `실시간 반영${result.price_fetched_at ? ` · ${formatDateTime(result.price_fetched_at)}` : ''}`
                : '종가 기준'}
            </td>
          </tr>
        </tbody>
      </table>
  )
}
