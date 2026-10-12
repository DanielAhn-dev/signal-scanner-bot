import React from 'react'
import { formatNumber } from '../../../lib/format'
import { POSITION_STATUS_LABEL, type PositionStatus } from '../telegramFormat'

export default function PositionStatusBadge({ status, changePct }: { status: PositionStatus; changePct: number | null }) {
  const cls =
    status === 'take_profit' ? 'sim-status-badge--profit'
    : status === 'near_profit' ? 'sim-status-badge--near-profit'
    : status === 'stop_loss' ? 'sim-status-badge--stop'
    : status === 'near_stop' ? 'sim-status-badge--near-stop'
    : 'sim-status-badge--hold'
  const label = POSITION_STATUS_LABEL[status]
  return (
    <span className={`sim-status-badge ${cls}`} title={changePct != null ? `${changePct >= 0 ? '+' : ''}${formatNumber(changePct, 2)}%` : ''}>
      {label}
      {changePct != null && (
        <span className="sim-status-badge-pct">{changePct >= 0 ? '+' : ''}{formatNumber(changePct, 1)}%</span>
      )}
    </span>
  )
}
