import React from 'react'

type ShareItem = {
  shareId: string
  publicToken: string
  url?: string
  topic: string
  expiresAt: string
  createdAt?: string
  revokedAt?: string | null
  accessCount?: number
  lastAccessedAt?: string | null
}

type Props = {
  open: boolean
  onClose: () => void
  url?: string | null
  code?: string | null
  expiresAt?: string | null
  shares?: ShareItem[]
  loading?: boolean
  onRefresh?: () => void
  onRevoke?: (shareId: string) => void
  revokingId?: string | null
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ShareModal({ open, onClose, url, code, expiresAt, shares = [], loading, onRefresh, onRevoke, revokingId }: Props) {
  if (!open) return null

  const copy = async (text?: string | null) => {
    try { await navigator.clipboard?.writeText(text || '') } catch {}
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal aria-label="공유 링크">
      <div className="modal card" style={{ maxWidth: 640 }}>
        <div className="flex-between">
          <h2 className="title-lg">공유 링크 생성됨</h2>
          <button className="nav-item" onClick={onClose}>닫기</button>
        </div>
        <div className="mt-2">
          <div className="muted">다음 URL을 받은 사용자에게 전달하세요. 접근 시 초대코드가 필요합니다.</div>
          <div style={{ marginTop: 12 }}>
            <div className="caption">URL</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input readOnly value={url || ''} style={{ flex: 1 }} className="ui-text" />
              <button className="ui-button ui-btn-secondary" onClick={() => copy(url)}>복사</button>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="caption">초대코드</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input readOnly value={code || ''} className="ui-text" style={{ width: 160 }} />
              <button className="ui-button ui-btn-secondary" onClick={() => copy(code)}>복사</button>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="caption">만료 시각</div>
            <div className="muted" style={{ marginTop: 6 }}>{formatDate(expiresAt)}</div>
          </div>
          <div style={{ marginTop: 18, borderTop: '1px solid var(--color-border-muted, #e5e7eb)', paddingTop: 14 }}>
            <div className="flex-between" style={{ alignItems: 'center' }}>
              <div>
                <div className="title-md">최근 공유 링크</div>
                <div className="muted" style={{ marginTop: 4 }}>같은 주제로 최근 발급된 링크를 보고 철회할 수 있습니다.</div>
              </div>
              <button className="ui-button ui-btn-secondary" onClick={onRefresh} disabled={loading}>새로고침</button>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 10, maxHeight: 280, overflow: 'auto' }}>
              {shares.length === 0 ? (
                <div className="muted">표시할 공유 링크가 없습니다.</div>
              ) : shares.map((share) => {
                const link = `${url?.split('?')[0] || ''}?share=${encodeURIComponent(share.publicToken)}`
                return (
                  <div key={share.shareId} className="card" style={{ margin: 0, padding: 12 }}>
                    <div className="caption">생성 {formatDate(share.createdAt)}</div>
                    <div className="muted" style={{ marginTop: 4 }}>만료 {formatDate(share.expiresAt)} · 조회 {share.accessCount || 0}회</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <button className="ui-button ui-btn-secondary" onClick={() => copy(share.url || link)}>링크 복사</button>
                      <button className="ui-button ui-btn-secondary" onClick={() => onRevoke?.(share.shareId)} disabled={revokingId === share.shareId}>
                        {revokingId === share.shareId ? '철회 중…' : '철회'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
