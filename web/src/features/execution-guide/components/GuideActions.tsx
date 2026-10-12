import React from 'react'
import { formatKrw, formatKstDateTime } from '../../../lib/format'
import Button from '../../../components/ui/Button'
import Detail from '../../../components/ui/Detail'
import ShareModal from '../../../components/ShareModal'
import type { useShareManager } from '../../../hooks/useShareManager'
import type { GuideRow } from '../types'

export type GuideActionsProps = {
  sourceLabel: string
  rows: GuideRow[]
  snapshotReady: boolean
  lastSnapshotAt: string | null
  pdfLoading: boolean
  shareManager: ReturnType<typeof useShareManager>
  openExecutionGuideShare: () => void | Promise<void>
  openExecutionGuideShareManager: () => void | Promise<void>
  downloadExecutionGuidePdf: () => void | Promise<void>
  totalPlanned: number
  totalCapital: number
}

export default function GuideActions({
  sourceLabel,
  rows,
  snapshotReady,
  lastSnapshotAt,
  pdfLoading,
  shareManager,
  openExecutionGuideShare,
  openExecutionGuideShareManager,
  downloadExecutionGuidePdf,
  totalPlanned,
  totalCapital,
}: GuideActionsProps) {
  return (
    <>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div>총 계획 금액: {formatKrw(totalPlanned)}</div>
          <div>잔여 현금: {formatKrw(Math.max(0, totalCapital - totalPlanned))}</div>
          <div>출처: {sourceLabel}</div>
        </div>
        <Detail><div className="caption muted">
          스냅샷: {snapshotReady ? '준비됨' : '미준비'}
          {lastSnapshotAt ? ` · 최근 저장 ${formatKstDateTime(lastSnapshotAt)}` : ''}
        </div></Detail>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" onClick={openExecutionGuideShare} disabled={shareManager.creating || rows.length === 0}>
            {shareManager.creating ? '공유 준비 중…' : '공유'}
          </Button>
          <Button size="sm" variant="secondary" onClick={downloadExecutionGuidePdf} disabled={pdfLoading || rows.length === 0}>
            {pdfLoading ? 'PDF 생성 중…' : '리포트 PDF'}
          </Button>
          <Button size="sm" variant="secondary" onClick={openExecutionGuideShareManager}>
            공유 관리
          </Button>
        </div>
      </div>

      <ShareModal
        open={shareManager.open}
        onClose={shareManager.close}
        url={shareManager.info?.url}
        code={shareManager.info?.code}
        requiresCode={shareManager.requiresCode}
        expiresAt={shareManager.info?.expiresAt}
        shares={shareManager.list}
        loading={shareManager.loading}
        onRefresh={() => { void shareManager.loadList('실행가이드') }}
        includeAll={shareManager.includeAll}
        onChangeIncludeAll={shareManager.setIncludeAll}
        onRevoke={shareManager.revokeShare}
        onRevokeAll={shareManager.revokeAllShares}
        revokingId={shareManager.revokingId}
        revokingAll={shareManager.revokingAll}
      />
    </>
  )
}
