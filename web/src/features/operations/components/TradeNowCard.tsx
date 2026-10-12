import React from 'react'
import Button from '../../../components/ui/Button'
import type { OpStatus } from '../types'

export type TradeNowCardProps = {
  autotriggerStatus: OpStatus
  autotriggerStep: 'intraday' | 'ready'
  setAutotriggerStep: React.Dispatch<React.SetStateAction<'intraday' | 'ready'>>
  autotriggerResult: string | null
  runAutotrigger: (stepOverride?: 'intraday' | 'ready') => Promise<void>
}

export default function TradeNowCard({
  autotriggerStatus,
  autotriggerStep,
  setAutotriggerStep,
  autotriggerResult,
  runAutotrigger,
}: TradeNowCardProps) {
  return (
    <div className="card card-lg" style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div className="title-lg">📊 지금 매매 체크</div>
        <div className="muted caption" style={{ marginTop: 'var(--space-1)' }}>
          현재 보유 포지션의 신호 재평가 및 손절/익절 조건을 확인합니다.
          보유 종목 중 조건을 만족하는 것이 있으면 거래 대기 상태로 표시됩니다.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          onClick={() => { void runAutotrigger() }}
          disabled={autotriggerStatus === 'loading'}
          style={{ minWidth: 160 }}
        >
          {autotriggerStatus === 'loading' ? '확인 중...' : '🔍 지금 확인'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setAutotriggerStep(autotriggerStep === 'intraday' ? 'ready' : 'intraday')}
          disabled={autotriggerStatus === 'loading'}
        >
          {autotriggerStep === 'intraday' ? '장중' : '장전'} 모드
        </Button>
      </div>
      {autotriggerResult && (
        <div
          className={autotriggerStatus === 'error' ? 'state-error' : 'caption muted'}
          style={{ marginTop: 'var(--space-3)' }}
        >
          {autotriggerResult}
        </div>
      )}
    </div>
  )
}
