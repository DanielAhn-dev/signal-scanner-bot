import React from 'react'
import { formatKrw } from '../../../lib/format'
import Skeleton from '../../../components/Skeleton'
import { translateOperationMessage } from '../lib/memo'
import type { OperationsKpi } from '../types'

export type KpiCardsProps = {
  dashboardKpi: OperationsKpi | null
  dashboardLoading: boolean
}

export default function KpiCards({
  dashboardKpi,
  dashboardLoading,
}: KpiCardsProps) {
  return (
    <div
      className="ops-kpi-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-6)',
      }}
    >
      {dashboardLoading && <Skeleton lines={2} height={16} />}
      {!dashboardLoading && dashboardKpi && (
        <>
          <div className="card">
            <div className="caption muted">오늘 체결</div>
            <div className="title-lg" style={{ marginTop: 'var(--space-1)' }}>{dashboardKpi.buy_count + dashboardKpi.sell_count}건</div>
            <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>매수 {dashboardKpi.buy_count} · 매도 {dashboardKpi.sell_count}</div>
          </div>
          <div className="card">
            <div className="caption muted">오늘 거래금액</div>
            <div className="title-lg" style={{ marginTop: 'var(--space-1)' }}>{formatKrw(dashboardKpi.trade_amount)}</div>
            <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>기준일 {dashboardKpi.asof}</div>
          </div>
          <div className="card">
            <div className="caption muted">자동사이클 실행</div>
            <div className="title-lg" style={{ marginTop: 'var(--space-1)' }}>{dashboardKpi.run_total}회</div>
            <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>성공 {dashboardKpi.run_success} · 실패 {dashboardKpi.run_failed}</div>
            {dashboardKpi.run_failed > 0 && dashboardKpi.latest_failed_reason && (
              <div className="caption" style={{ marginTop: 'var(--space-1)', color: 'var(--color-error)' }}>
                최근 실패: {translateOperationMessage(dashboardKpi.latest_failed_reason)}
              </div>
            )}
          </div>
          <div className="card">
            <div className="caption muted">큐 대기/보유</div>
            <div className="title-lg" style={{ marginTop: 'var(--space-1)' }}>{dashboardKpi.queue_waiting} / {dashboardKpi.holding_count}</div>
            <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>대기작업 / 보유종목</div>
          </div>
          {dashboardKpi.virtual_seed_capital != null && (
            <div className="card">
              <div className="caption muted">가상 현금 잔액</div>
              <div className="title-lg" style={{ marginTop: 'var(--space-1)' }}>
                {dashboardKpi.virtual_cash != null ? formatKrw(dashboardKpi.virtual_cash) : '-'}
              </div>
              <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
                시드 {formatKrw(dashboardKpi.virtual_seed_capital)}
                {dashboardKpi.virtual_cash != null && dashboardKpi.virtual_seed_capital > 0 && (
                  <span style={{ marginLeft: 6 }}>
                    ({((dashboardKpi.virtual_cash / dashboardKpi.virtual_seed_capital) * 100).toFixed(1)}%)
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
