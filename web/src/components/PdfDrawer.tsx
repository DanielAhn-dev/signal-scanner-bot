import React, { useEffect } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  title?: string
  pdfUrl?: string | null
  loading?: boolean
  onFrameLoad?: () => void
  onFrameError?: () => void
}

export default function PdfDrawer({
  open,
  onClose,
  title = '문서 미리보기',
  pdfUrl,
  loading,
  onFrameLoad,
  onFrameError,
}: Props) {
  useEffect(() => {
    if (!open) return

    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
    }
  }, [open])

  if (!open) return null

  return (
    <div className="report-drawer-overlay" role="dialog" aria-modal={true} aria-label={title} onClick={onClose}>
      <aside className="report-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="report-drawer-header">
          <div className="report-drawer-title">{title}</div>
          <button className="nav-item" onClick={onClose}>닫기</button>
        </div>
        <div className="report-drawer-content">
          {pdfUrl ? (
            <>
              <iframe
                title={title}
                src={pdfUrl}
                style={{ width: '100%', height: '100%', border: 'none' }}
                onLoad={onFrameLoad}
                onError={onFrameError}
              />
              {loading ? (
                <div
                  className="muted"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(255,255,255,0.75)',
                    backdropFilter: 'blur(2px)',
                    zIndex: 2,
                  }}
                >
                  리포트 생성 중…
                </div>
              ) : null}
            </>
          ) : (
            <div className="muted">미리보기를 불러오지 못했습니다.</div>
          )}
        </div>
      </aside>
    </div>
  )
}
