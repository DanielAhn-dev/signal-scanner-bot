import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'
import { formatKstDateTime } from '../lib/format'

type Props = {
  open: boolean
  onClose: () => void
  /** 빈 문자열이면 리포트를 생성 중인 상태로 본다. */
  url: string
  title: string
  generatedAt?: string
  error?: string
}

export default function ReportPreviewModal({ open, onClose, url, title, generatedAt, error }: Props) {
  const [frameLoading, setFrameLoading] = useState(true)
  const [frameError, setFrameError] = useState<string | null>(null)

  const generatedLabel = useMemo(() => {
    if (!generatedAt) return ''
    return formatKstDateTime(generatedAt)
  }, [generatedAt])

  useEffect(() => {
    if (!open) return
    setFrameLoading(true)
    setFrameError(null)
  }, [open, url])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const fetching = !url && !error
  const loading = fetching || (!!url && frameLoading)
  const errorMessage = error || frameError

  const loadingHint = useMemo(() => {
    if (!fetching) return '미리보기를 표시하는 중입니다...'
    if (title.includes('눌림목')) return '눌림목 후보를 조회해 리포트를 만드는 중입니다...'
    return '최신 데이터로 리포트를 만드는 중입니다...'
  }, [fetching, title])

  // blob URL은 noopener로 열면 Chromium에서 빈 창이 되므로 opener만 끊고 연다.
  const openInNewWindow = () => {
    if (!url) return
    const win = window.open(url, '_blank')
    if (win) win.opener = null
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal report-preview-modal" role="dialog" aria-modal="true" aria-labelledby="report-preview-title">
        <div className="report-preview-modal__header">
          <div className="report-preview-modal__heading">
            <div className="report-preview-modal__eyebrow">공유 전 확인</div>
            <div id="report-preview-title" className="report-preview-modal__title">{title}</div>
            <div className="report-preview-modal__meta">
              <span className="report-preview-modal__status" data-state={errorMessage ? 'error' : loading ? 'loading' : 'ready'}>
                {errorMessage ? '불러오기 실패' : fetching ? '리포트 생성 중' : '최신 데이터 미리보기'}
              </span>
              {generatedLabel && !fetching && (
                <span className="report-preview-modal__generated">생성 {generatedLabel}</span>
              )}
            </div>
          </div>
          <div className="report-preview-modal__actions">
            <button
              type="button"
              className="ui-button ui-btn-secondary ui-btn-sm"
              onClick={openInNewWindow}
              disabled={!url}
              title={url ? '새 창에서 열기' : '리포트 생성 후 사용할 수 있습니다'}
            >
              <ExternalLink size={14} /> 새 창
            </button>
            <button type="button" className="modal-close" onClick={onClose} title="닫기" aria-label="미리보기 닫기"><X size={17} /></button>
          </div>
        </div>
        <div className="report-preview-modal__viewport" aria-busy={loading}>
          {url && (
            <iframe
              key={url}
              src={url}
              title={title}
              onLoad={() => setFrameLoading(false)}
              onError={() => {
                setFrameLoading(false)
                setFrameError('미리보기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
              }}
              className="report-preview-modal__frame"
            />
          )}
          {loading && !errorMessage && (
            <div className="report-preview-modal__skeleton" role="status" aria-live="polite">
              <div className="report-preview-modal__hint">
                <span className="report-preview-modal__spinner" aria-hidden="true" />
                {loadingHint}
              </div>
              <div className="report-preview-modal__bar" style={{ height: 26, width: '42%' }} />
              <div className="report-preview-modal__bar" style={{ width: '88%' }} />
              <div className="report-preview-modal__bar" style={{ width: '78%' }} />
              <div className="report-preview-modal__bar" style={{ width: '67%' }} />
              <div className="report-preview-modal__skeleton-card">
                <div className="report-preview-modal__bar" style={{ height: 14, width: '52%' }} />
                <div className="report-preview-modal__bar" style={{ width: '95%' }} />
                <div className="report-preview-modal__bar" style={{ width: '92%' }} />
                <div className="report-preview-modal__bar" style={{ width: '75%' }} />
              </div>
            </div>
          )}
          {!!errorMessage && (
            <div className="report-preview-modal__error" role="alert">{errorMessage}</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
