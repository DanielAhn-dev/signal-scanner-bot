import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  open: boolean
  onClose: () => void
  url: string
  title: string
  generatedAt?: string
}

export default function ReportPreviewModal({ open, onClose, url, title, generatedAt }: Props) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const generatedLabel = useMemo(() => {
    if (!generatedAt) return ''
    const t = new Date(generatedAt)
    if (Number.isNaN(t.getTime())) return ''
    return t.toLocaleString('ko-KR', { hour12: false })
  }, [generatedAt])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setLoadError(null)
  }, [open, url])

  const loadingHint = useMemo(() => {
    if (title.includes('눌림목')) return '눌림목 후보를 조회 중입니다...'
    return '리포트 데이터를 불러오는 중입니다...'
  }, [title])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal aria-label="리포트 미리보기">
      <div className="modal card" style={{ width: 'min(1120px, 96vw)', maxHeight: '92vh', padding: 0, overflow: 'hidden' }}>
        <div className="flex-between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-muted, #e5e7eb)' }}>
          <div>
            <div className="title-md" style={{ margin: 0 }}>공유 전 미리보기</div>
            <div className="caption" style={{ marginTop: 4 }}>{title}</div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 9px',
                borderRadius: 999,
                border: '1px solid #bfdbfe',
                background: '#eff6ff',
                color: '#1d4ed8',
                fontSize: 11,
                fontWeight: 700,
              }}>
                실시간 생성 미리보기
              </span>
              {generatedLabel && (
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  생성 시각 {generatedLabel}
                </span>
              )}
            </div>
          </div>
          <button className="nav-item" onClick={onClose}>닫기</button>
        </div>
        <div style={{ position: 'relative', width: '100%', height: 'calc(92vh - 64px)', background: '#f2f4f6' }} aria-busy={loading}>
          <iframe
            src={url}
            title={title}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false)
              setLoadError('미리보기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
            }}
            style={{ width: '100%', height: '100%', border: 0, background: '#f2f4f6' }}
          />
          {loading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, #f8fafc 0%, #f2f4f6 100%)',
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}>
              <style>{`@keyframes report-preview-skeleton { 0% { opacity: 0.45; } 50% { opacity: 1; } 100% { opacity: 0.45; } }`}</style>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{loadingHint}</div>
              <div style={{ height: 26, width: '42%', borderRadius: 8, background: '#dbe3ea', animation: 'report-preview-skeleton 1.25s ease-in-out infinite' }} />
              <div style={{ height: 16, width: '88%', borderRadius: 6, background: '#e4e9ef', animation: 'report-preview-skeleton 1.25s ease-in-out infinite' }} />
              <div style={{ height: 16, width: '78%', borderRadius: 6, background: '#e4e9ef', animation: 'report-preview-skeleton 1.25s ease-in-out infinite' }} />
              <div style={{ height: 16, width: '67%', borderRadius: 6, background: '#e4e9ef', animation: 'report-preview-skeleton 1.25s ease-in-out infinite' }} />
              <div style={{ marginTop: 8, borderRadius: 10, border: '1px solid #d8e2ef', background: '#ffffff', padding: 12 }}>
                <div style={{ height: 14, width: '52%', borderRadius: 6, background: '#e8edf3', animation: 'report-preview-skeleton 1.25s ease-in-out infinite' }} />
                <div style={{ marginTop: 8, height: 13, width: '95%', borderRadius: 6, background: '#edf1f6', animation: 'report-preview-skeleton 1.25s ease-in-out infinite' }} />
                <div style={{ marginTop: 6, height: 13, width: '92%', borderRadius: 6, background: '#edf1f6', animation: 'report-preview-skeleton 1.25s ease-in-out infinite' }} />
                <div style={{ marginTop: 6, height: 13, width: '75%', borderRadius: 6, background: '#edf1f6', animation: 'report-preview-skeleton 1.25s ease-in-out infinite' }} />
              </div>
            </div>
          )}
          {!!loadError && (
            <div style={{
              position: 'absolute',
              left: 16,
              right: 16,
              bottom: 16,
              borderRadius: 10,
              padding: '10px 12px',
              background: '#fff8f8',
              border: '1px solid #f7caca',
              color: '#9f3a38',
              fontSize: 12,
            }}>
              {loadError}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
