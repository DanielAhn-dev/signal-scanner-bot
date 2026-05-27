import React from 'react'
import { createPortal } from 'react-dom'

type Props = {
  open: boolean
  onClose: () => void
  url: string
  title: string
}

export default function ReportPreviewModal({ open, onClose, url, title }: Props) {
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal aria-label="리포트 미리보기">
      <div className="modal card" style={{ width: 'min(1120px, 96vw)', maxHeight: '92vh', padding: 0, overflow: 'hidden' }}>
        <div className="flex-between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-muted, #e5e7eb)' }}>
          <div>
            <div className="title-md" style={{ margin: 0 }}>공유 전 미리보기</div>
            <div className="caption" style={{ marginTop: 4 }}>{title}</div>
          </div>
          <button className="nav-item" onClick={onClose}>닫기</button>
        </div>
        <iframe
          src={url}
          title={title}
          style={{ width: '100%', height: 'calc(92vh - 64px)', border: 0, background: '#f2f4f6' }}
        />
      </div>
    </div>,
    document.body,
  )
}
