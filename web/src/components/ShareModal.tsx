import React from 'react'
import { createPortal } from 'react-dom'

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
  requiresCode?: boolean
  expiresAt?: string | null
  shares?: ShareItem[]
  loading?: boolean
  onRefresh?: () => void
  onRevoke?: (shareId: string) => void
  onRevokeAll?: () => void
  revokingId?: string | null
  revokingAll?: boolean
  includeAll?: boolean
  onChangeIncludeAll?: (next: boolean) => void
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const SHARE_MODAL_SORT_KEY = 'share_modal_sort_v1'
const SHARE_MODAL_FILTER_KEY = 'share_modal_filter_v1'

export default function ShareModal({
  open,
  onClose,
  url,
  code,
  requiresCode = true,
  expiresAt,
  shares = [],
  loading,
  onRefresh,
  onRevoke,
  onRevokeAll,
  revokingId,
  revokingAll = false,
  includeAll = false,
  onChangeIncludeAll,
}: Props) {
  if (!open) return null

  const [sortBy, setSortBy] = React.useState<'recent' | 'views' | 'expires'>('recent')
  const [listFilter, setListFilter] = React.useState<'active' | 'all'>(includeAll ? 'all' : 'active')

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = String(window.localStorage.getItem(SHARE_MODAL_SORT_KEY) || '').trim()
      if (saved === 'recent' || saved === 'views' || saved === 'expires') {
        setSortBy(saved)
      }
      const savedFilter = String(window.localStorage.getItem(SHARE_MODAL_FILTER_KEY) || '').trim()
      if (savedFilter === 'active' || savedFilter === 'all') {
        setListFilter(savedFilter)
      }
    } catch {
      // ignore local storage read errors
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(SHARE_MODAL_SORT_KEY, sortBy)
    } catch {
      // ignore local storage write errors
    }
  }, [sortBy])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(SHARE_MODAL_FILTER_KEY, listFilter)
    } catch {
      // ignore local storage write errors
    }
  }, [listFilter])

  React.useEffect(() => {
    onChangeIncludeAll?.(listFilter === 'all')
  }, [listFilter, onChangeIncludeAll])

  const copy = async (text?: string | null) => {
    try { await navigator.clipboard?.writeText(text || '') } catch {}
  }

  const sortedShares = React.useMemo(() => {
    const base = [...shares]
    if (sortBy === 'views') {
      return base.sort((a, b) => Number(b.accessCount || 0) - Number(a.accessCount || 0))
    }
    if (sortBy === 'expires') {
      return base.sort((a, b) => {
        const av = new Date(a.expiresAt).getTime()
        const bv = new Date(b.expiresAt).getTime()
        return av - bv
      })
    }
    return base.sort((a, b) => {
      const av = new Date(a.createdAt || a.expiresAt).getTime()
      const bv = new Date(b.createdAt || b.expiresAt).getTime()
      return bv - av
    })
  }, [shares, sortBy])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal aria-label="공유 링크">
      <div className="modal card share-modal">
        <div className="flex-between" style={{ alignItems: 'flex-start' }}>
          <h2 className="title-lg">공유 링크 생성됨</h2>
          <button className="nav-item" onClick={onClose} style={{ marginLeft: 'auto' }}>닫기</button>
        </div>
        <div className="mt-2">
          <div className="muted">
            {requiresCode
              ? '다음 URL을 받은 사용자에게 전달하세요. 링크만으로도 열 수 있고, 초대코드가 있으면 추가로 확인할 수 있습니다.'
              : '다음 URL을 받은 사용자에게 전달하세요. 링크를 열면 바로 공유 화면이 표시됩니다.'}
          </div>
          <div
            style={{
              marginTop: 12,
              padding: '12px 14px',
              borderRadius: 14,
              background: 'var(--color-surface-muted, #f8fafc)',
              border: '1px solid var(--color-border-muted, #e5e7eb)',
            }}
          >
            <div className="caption" style={{ color: 'var(--color-text-primary, #111827)', fontWeight: 700 }}>안내</div>
            <div className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
              {requiresCode
                ? '초대코드는 참고용입니다. 링크만으로도 열 수 있으며, 다시 생성하면 이전 링크와 새 정보가 바뀝니다.'
                : '공유 링크를 다시 생성하면 이전 링크는 즉시 만료되고, 새로 발급된 링크만 사용할 수 있습니다.'}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="caption">URL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
              <input readOnly value={url || ''} style={{ flex: 1, minWidth: 0, width: '100%' }} className="ui-text" />
              <button className="ui-button ui-btn-secondary" style={{ width: '100%' }} onClick={() => copy(url)}>복사</button>
            </div>
          </div>
          {requiresCode && (
            <div style={{ marginTop: 12 }}>
              <div className="caption">초대코드</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                <input readOnly value={code || ''} className="ui-text" style={{ width: '100%' }} />
                <button className="ui-button ui-btn-secondary" style={{ width: '100%' }} onClick={() => copy(code)}>복사</button>
              </div>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <div className="caption">만료 시각</div>
            <div className="muted" style={{ marginTop: 6 }}>{formatDate(expiresAt)}</div>
          </div>
          <div style={{ marginTop: 18, borderTop: '1px solid var(--color-border-muted, #e5e7eb)', paddingTop: 14 }}>
            <div style={{ marginBottom: 12 }}>
              <div className="title-md">최근 공유 링크</div>
              <div className="muted" style={{ marginTop: 4 }}>같은 주제로 최근 발급된 링크를 보고 철회할 수 있습니다.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, alignItems: 'stretch' }}>
              <select
                className="input"
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value === 'all' ? 'all' : 'active')}
                style={{ width: '100%' }}
              >
                <option value="active">활성 링크만</option>
                <option value="all">전체 링크</option>
              </select>
              <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'recent' | 'views' | 'expires')} style={{ width: '100%' }}>
                <option value="recent">최신순</option>
                <option value="views">조회수순</option>
                <option value="expires">만료임박순</option>
              </select>
              <button className="ui-button ui-btn-secondary" onClick={onRefresh} disabled={loading} style={{ width: '100%' }}>새로고침</button>
              <button className="ui-button ui-btn-secondary" onClick={onRevokeAll} disabled={revokingAll || !onRevokeAll} style={{ width: '100%' }}>
                {revokingAll ? '전체 철회 중…' : '활성 전체 철회'}
              </button>
            </div>
            <div className="share-modal__recent-list" style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              {sortedShares.length === 0 ? (
                <div className="muted">표시할 공유 링크가 없습니다.</div>
              ) : sortedShares.map((share) => {
                const link = `${url?.split('?')[0] || ''}?share=${encodeURIComponent(share.publicToken)}`
                return (
                  <div key={share.shareId} className="card" style={{ margin: 0, padding: 12 }}>
                    <div className="caption">생성 {formatDate(share.createdAt)}</div>
                    <div className="muted" style={{ marginTop: 4 }}>만료 {formatDate(share.expiresAt)} · 조회 {share.accessCount || 0}회</div>
                    <div className="share-modal__item-actions" style={{ marginTop: 10 }}>
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
    </div>,
    document.body,
  )
}
