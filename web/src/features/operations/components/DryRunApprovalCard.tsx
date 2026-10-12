import React from 'react'
import Button from '../../../components/ui/Button'
import type { OpStatus } from '../types'

export type DryRunApprovalCardProps = {
  autocycleStatus: OpStatus
  runAutocycle: (dryRun: boolean, learning?: boolean) => Promise<void>
  pendingDryRunApproval: { jobId: string; summary: string }
  setPendingDryRunApproval: React.Dispatch<React.SetStateAction<{ jobId: string; summary: string } | null>>
}

export default function DryRunApprovalCard({
  autocycleStatus,
  runAutocycle,
  pendingDryRunApproval,
  setPendingDryRunApproval,
}: DryRunApprovalCardProps) {
  return (
    <div className="card card-lg" style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--color-blue-200)', background: 'var(--color-blue-50)' }}>
      <div className="title-lg">드라이런 결과 검토 완료</div>
      <div className="muted" style={{ marginTop: 'var(--space-1)' }}>
        job_id: {pendingDryRunApproval.jobId}
      </div>
      <div className="caption muted" style={{ marginTop: 'var(--space-2)' }}>
        {pendingDryRunApproval.summary}
      </div>
      <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          onClick={() => runAutocycle(false)}
          disabled={autocycleStatus === 'loading'}
        >
          결과 수락 후 실제 실행
        </Button>
        <Button
          variant="ghost"
          onClick={() => setPendingDryRunApproval(null)}
        >
          보류
        </Button>
      </div>
    </div>
  )
}
