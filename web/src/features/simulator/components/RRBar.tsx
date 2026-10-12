import React from 'react'
import { formatNumber } from '../../../lib/format'

export default function RRBar({ rr }: { rr: number }) {
  const pct = Math.min(100, (rr / 4) * 100)
  const color = rr >= 2.5 ? 'var(--color-success)' : rr >= 2.0 ? 'var(--color-brand)' : rr >= 1.5 ? 'var(--color-warning)' : 'var(--color-error)'
  return (
    <div className="sim-rr-bar-wrap" title={`R:R = ${formatNumber(rr, 2)}`}>
      <div className="sim-rr-bar-track">
        <div className="sim-rr-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="sim-rr-label" style={{ color }}>{formatNumber(rr, 1)}:1</span>
    </div>
  )
}
