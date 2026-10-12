import React from 'react'
import Button from '../../../components/ui/Button'
import type { OpStatus } from '../types'

export type DryRunBannerProps = {
  autocycleStatus: OpStatus
  runAutocycle: (dryRun: boolean, learning?: boolean) => Promise<void>
  pendingDryRunApproval: { jobId: string; summary: string }
  setBannerDismissedForJobId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedDryRunJobId: React.Dispatch<React.SetStateAction<string | null>>
}

export default function DryRunBanner({
  autocycleStatus,
  runAutocycle,
  pendingDryRunApproval,
  setBannerDismissedForJobId,
  setSelectedDryRunJobId,
}: DryRunBannerProps) {
  return (
    <div
      className="card"
      style={{
        marginBottom: 'var(--space-4)',
        borderColor: 'var(--color-blue-200)',
        background: 'var(--color-blue-50)',
        position: 'sticky',
        top: 72,
        zIndex: 220,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <div>
          <div className="title-md">드라이런 검토 완료: 실행 여부를 선택하세요</div>
          <div className="caption muted" style={{ marginTop: 4 }}>job_id: {pendingDryRunApproval.jobId} · {pendingDryRunApproval.summary}</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={() => runAutocycle(false)} disabled={autocycleStatus === 'loading'}>
            결과 수락 후 실제 실행
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSelectedDryRunJobId(pendingDryRunApproval.jobId)}
          >
            상세 보기
          </Button>
          <Button
            variant="ghost"
            onClick={() => setBannerDismissedForJobId(pendingDryRunApproval.jobId)}
          >
            닫기
          </Button>
        </div>
      </div>
    </div>
  )
}
