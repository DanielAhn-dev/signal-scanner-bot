import React from 'react'
import { formatKrw, formatKstDateTime } from '../../../lib/format'
import Button from '../../../components/ui/Button'
import Skeleton from '../../../components/Skeleton'
import { interpretMemo } from '../lib/memo'
import { cardBgStyle, sideBadge } from './badges'
import type { TradeRow } from '../types'

export type ActivityListProps = {
  activity: TradeRow[]
  activityLoading: boolean
  loadActivity: () => void | Promise<void>
}

export default function ActivityList({
  activity,
  activityLoading,
  loadActivity,
}: ActivityListProps) {
  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h2 className="title-lg">최근 실행 이력 (최근 20건)</h2>
        <Button variant="ghost" onClick={loadActivity} disabled={activityLoading}>새로고침</Button>
      </div>
      {activityLoading && <Skeleton lines={5} height={18} />}
      {!activityLoading && activity.length === 0 && (
        <div className="card"><div className="muted">실행 이력 없음</div></div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {!activityLoading && activity.map((row, idx) => {
        const { label: memoLabel, reason: memoReason } = interpretMemo(row.memo)
        const isRecent = idx === 0
        const feeAmt = Number(row.fee_amount ?? 0)
        const taxAmt = Number(row.tax_amount ?? 0)
        const buyFeeAmt = Number(row.buy_fee_amount ?? 0)
        const totalCost = feeAmt + taxAmt + buyFeeAmt
        const pnlAmt = row.pnl_amount != null ? Number(row.pnl_amount) : null
        const isSell = row.side === 'SELL'
        return (
        <div key={row.id} className="card" style={{ ...cardBgStyle(row.side), ...(isRecent ? { boxShadow: '0 0 0 2px var(--color-brand)' } : {}) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span className="font-medium">{row.stock_name || row.code}</span>
              {row.stock_name && (
                <span className="caption muted" style={{ marginLeft: 'var(--space-2)' }}>({row.code})</span>
              )}
              <span style={{ marginLeft: 'var(--space-2)' }}>{sideBadge(row.side)}</span>
              <span className="caption muted" style={{ marginLeft: 'var(--space-2)' }}>
                {row.quantity}주 · {formatKrw(row.price)}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="caption muted">{formatKstDateTime(row.created_at)}</div>
              {isRecent && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-brand)', fontWeight: 'var(--font-weight-semibold)' }}>최근</div>}
            </div>
          </div>
          {/* 해석된 매매 이유 */}
          <div style={{ marginTop: 'var(--space-1)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: row.side === 'BUY' ? 'var(--color-stock-up)' : row.side === 'SELL' ? 'var(--color-stock-down)' : 'var(--color-text-secondary)', background: row.side === 'BUY' ? 'var(--color-stock-up-bg)' : row.side === 'SELL' ? 'var(--color-stock-down-bg)' : 'var(--color-stock-flat-bg)', borderRadius: 'var(--radius-sm)', padding: '2px 8px' }}>
              {memoLabel}
            </span>
            {memoReason && <span className="caption muted">{memoReason}</span>}
          </div>
          {/* 매매비용 / 실수익 */}
          {totalCost > 0 && (
            <div className="caption muted" style={{ marginTop: 'var(--space-1)', display: 'flex', gap: 'var(--space-3)' }}>
              <span>수수료 {formatKrw(feeAmt)}</span>
              {taxAmt > 0 && <span>거래세 {formatKrw(taxAmt)}</span>}
              {isSell && buyFeeAmt > 0 && <span>매수 수수료 {formatKrw(buyFeeAmt)}</span>}
              <span>총비용 {formatKrw(totalCost)}</span>
            </div>
          )}
          {isSell && pnlAmt != null && (
            <div style={{ marginTop: 'var(--space-1)', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: pnlAmt >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)' }}>
              순손익 {pnlAmt >= 0 ? '+' : ''}{formatKrw(pnlAmt)}
              {totalCost > 0 && (
                <span style={{ fontWeight: 'var(--font-weight-regular)', color: 'var(--color-text-tertiary)', marginLeft: 'var(--space-2)' }}>
                  (수수료·세금 빼기 전 {pnlAmt + totalCost >= 0 ? '+' : ''}{formatKrw(pnlAmt + totalCost)})
                </span>
              )}
            </div>
          )}
        </div>
      )})}
      </div>
    </div>
  )
}
