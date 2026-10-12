import React from 'react'
import { formatKrw } from '../../../lib/format'

export type PriceRangeBarProps = {
  result: any
  intradayDelta: number | null
  priceBarPct: number | null
}

export default function PriceRangeBar({
  result,
  intradayDelta,
  priceBarPct,
}: PriceRangeBarProps) {
  return (
    <>
        {result.high != null && result.low != null && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
              <span className="caption">{formatKrw(result.low)}</span>
              <span className="caption" style={{ color: 'var(--color-text-tertiary)' }}>일중 범위</span>
              <span className="caption">{formatKrw(result.high)}</span>
            </div>
            <div style={{
              height: 6,
              background: 'var(--color-border-default)',
              borderRadius: 999,
              position: 'relative',
            }}>
              {priceBarPct != null && (
                <div style={{
                  position: 'absolute',
                  left: `${Math.max(2, Math.min(98, priceBarPct))}%`,
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: intradayDelta != null
                    ? intradayDelta > 0
                      ? 'var(--color-stock-up)'
                      : intradayDelta < 0
                        ? 'var(--color-stock-down)'
                        : 'var(--color-stock-flat)'
                    : result.change_pct > 0
                    ? 'var(--color-stock-up)'
                    : result.change_pct < 0
                      ? 'var(--color-stock-down)'
                      : 'var(--color-stock-flat)',
                  border: '2px solid var(--color-bg-surface)',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                }} />
              )}
            </div>
            <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
              원형 색상 기준: 시가 대비 {intradayDelta == null ? '미확인' : intradayDelta > 0 ? '상승(빨강)' : intradayDelta < 0 ? '하락(파랑)' : '보합'}
            </div>
          </div>
        )}
    </>
  )
}
