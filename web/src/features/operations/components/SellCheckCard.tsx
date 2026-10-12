import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import Button from '../../../components/ui/Button'
import type { SellCandidate } from '../types'

export type SellCheckCardProps = {
  sellCandidates: SellCandidate[]
  sellLoading: boolean
  sellFetched: boolean
  fetchSellCandidates: () => void | Promise<void>
}

export default function SellCheckCard({
  sellCandidates,
  sellLoading,
  sellFetched,
  fetchSellCandidates,
}: SellCheckCardProps) {
  return (
    <div className="card card-lg" style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div className="title-lg">자동매도 점검 (autosellcheck)</div>
        <div className="muted caption" style={{ marginTop: 'var(--space-1)' }}>
          현재 보유 종목의 현재가 기준 수익률을 조회합니다. 하락 순으로 정렬됩니다.
        </div>
      </div>
      <Button
        variant="secondary"
        onClick={fetchSellCandidates}
        disabled={sellLoading}
      >
        {sellLoading ? '조회 중...' : '점검 조회'}
      </Button>
      {sellFetched && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          {sellCandidates.length === 0 ? (
            <div className="caption muted">보유 포지션 없음</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {sellCandidates.map(c => (
                <div key={c.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="font-medium">{c.name || c.code}</span>
                    <span className="caption muted"> ({c.code}) · {c.quantity}주</span>
                  </div>
                  <div className="text-right">
                    <span
                      className={c.pct_change < 0 ? 'negative' : 'positive'}
                      style={{ fontWeight: 600 }}
                    >
                      {c.pct_change > 0 ? '+' : ''}{formatNumber(c.pct_change, 2)}%
                    </span>
                    <div className="caption muted">
                      {formatKrw(c.current_price)} / 평균 {formatKrw(c.buy_price)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
