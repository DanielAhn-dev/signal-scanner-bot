import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/Modal'

type DeleteConfirmModalProps = {
  deleteConfirmOpen: boolean
  setDeleteConfirmOpen: (open: boolean) => void
  deleteConfirmCode: string
  setMaintMode: (v: 'holdingdelete') => void
  setMaintCode: (v: string) => void
  runMaintenance: () => void
  maintLoading: boolean
}

export default function DeleteConfirmModal({
  deleteConfirmOpen,
  setDeleteConfirmOpen,
  deleteConfirmCode,
  setMaintMode,
  setMaintCode,
  runMaintenance,
  maintLoading,
}: DeleteConfirmModalProps) {
  return (
    <Modal
      isOpen={deleteConfirmOpen}
      title="종목 완전 삭제"
      onClose={() => setDeleteConfirmOpen(false)}
      size="sm"
    >
      <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
        <strong style={{ color: 'var(--color-error)' }}>{deleteConfirmCode || '종목'}</strong>을(를) 포트폴리오에서 완전히 삭제합니다.
      </div>
      <div className="muted" style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)', opacity: 0.8 }}>
        • 보유 수량 및 평가손익이 제거됩니다<br />
        • 모든 거래 기록이 삭제됩니다 (복구 불가)<br />
        • 스냅샷도 함께 제거됩니다
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button variant="primary" onClick={() => { setMaintMode('holdingdelete'); setMaintCode(deleteConfirmCode); runMaintenance() }} disabled={maintLoading} style={{ background: 'var(--color-error)' }}>
          {maintLoading ? '삭제 중…' : '삭제 확인'}
        </Button>
        <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>취소</Button>
      </div>
    </Modal>
  )
}
