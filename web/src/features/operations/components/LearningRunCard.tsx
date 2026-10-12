import React from 'react'
import Button from '../../../components/ui/Button'
import type { OpStatus } from '../types'

export type LearningRunCardProps = {
  autocycleStatus: OpStatus
  runAutocycle: (dryRun: boolean, learning?: boolean) => Promise<void>
}

export default function LearningRunCard({
  autocycleStatus,
  runAutocycle,
}: LearningRunCardProps) {
  return (
    <div className="card card-lg" style={{ marginBottom: 'var(--space-4)' }}>
      <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>학습 실행</div>
      <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
        전략 파라미터 학습용 점검/실행입니다. 일상적인 매매 확인과는 별개의 운영자 작업입니다.
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={() => runAutocycle(true, true)} disabled={autocycleStatus === 'loading'}>
          학습 점검
        </Button>
        <Button variant="secondary" onClick={() => runAutocycle(false, true)} disabled={autocycleStatus === 'loading'}>
          학습 실행
        </Button>
      </div>
    </div>
  )
}
