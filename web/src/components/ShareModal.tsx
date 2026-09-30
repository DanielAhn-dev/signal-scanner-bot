import React from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, RefreshCw, X } from 'lucide-react'

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
  const [sortBy, setSortBy] = React.useState<'recent' | 'views' | 'expires'>('recent')
  const [listFilter, setListFilter] = React.useState<'active' | 'all'>(includeAll ? 'all' : 'active')
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)

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

  React.useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const copy = async (text: string | null | undefined, key: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey((current) => current === key ? null : current), 1600)
    } catch {
      setCopiedKey(null)
    }
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

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal share-modal" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
        <div className="modal-header share-modal__header">
          <div>
            <div className="share-modal__eyebrow">외부 공유</div>
            <h2 id="share-modal-title" className="modal-title">공유 링크</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="공유 창 닫기" title="닫기"><X size={17} /></button>
        </div>
        <div className="share-modal__body">
          <div className="share-modal__intro">
            {requiresCode
              ? '다음 URL을 받은 사용자에게 전달하세요. 링크만으로도 열 수 있고, 초대코드가 있으면 추가로 확인할 수 있습니다.'
              : '다음 URL을 받은 사용자에게 전달하세요. 링크를 열면 바로 공유 화면이 표시됩니다.'}
          </div>
          <div className="share-modal__notice">
            <div className="caption">링크 정책</div>
            <div className="muted">
              {requiresCode
                ? '초대코드는 참고용입니다. 링크만으로도 열 수 있으며, 다시 생성하면 이전 링크와 새 정보가 바뀝니다.'
                : '공유 링크를 다시 생성하면 이전 링크는 즉시 만료되고, 새로 발급된 링크만 사용할 수 있습니다.'}
            </div>
          </div>
          <div className="share-modal__field">
            <div className="caption">URL</div>
            <div className="share-modal__copy-row">
              <input readOnly value={url || ''} className="ui-text" />
              <button className="ui-button ui-btn-primary" onClick={() => copy(url, 'current-url')} disabled={!url}>
                {copiedKey === 'current-url' ? <Check size={14} /> : <Copy size={14} />}
                {copiedKey === 'current-url' ? '복사됨' : '링크 복사'}
              </button>
            </div>
          </div>
          {requiresCode && (
            <div className="share-modal__field">
              <div className="caption">초대코드</div>
              <div className="share-modal__copy-row">
                <input readOnly value={code || ''} className="ui-text" />
                <button className="ui-button ui-btn-secondary" onClick={() => copy(code, 'invite-code')} disabled={!code}>
                  {copiedKey === 'invite-code' ? <Check size={14} /> : <Copy size={14} />}
                  {copiedKey === 'invite-code' ? '복사됨' : '코드 복사'}
                </button>
              </div>
            </div>
          )}
          <div className="share-modal__expires">
            <div className="caption">만료 시각</div>
            <div>{formatDate(expiresAt)}</div>
          </div>
          <div className="share-modal__history">
            <div className="share-modal__history-header">
              <div>
              <div className="title-md">최근 공유 링크</div>
                <div className="muted">발급 이력과 조회 수를 확인하고 철회할 수 있습니다.</div>
              </div>
              <button className="share-modal__icon-button" onClick={onRefresh} disabled={loading} title="새로고침" aria-label="공유 목록 새로고침">
                <RefreshCw size={15} />
              </button>
            </div>
            <div className="share-modal__filters">
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
              <button className="ui-button ui-btn-secondary" onClick={onRevokeAll} disabled={revokingAll || !onRevokeAll}>
                {revokingAll ? '전체 철회 중…' : '활성 전체 철회'}
              </button>
            </div>
            <div className="share-modal__recent-list">
              {sortedShares.length === 0 ? (
                <div className="share-modal__empty">표시할 공유 링크가 없습니다.</div>
              ) : sortedShares.map((share) => {
                const link = `${url?.split('?')[0] || ''}?share=${encodeURIComponent(share.publicToken)}`
                return (
                  <div key={share.shareId} className="share-modal__item">
                    <div className="share-modal__item-meta">
                      <div className="caption">{share.topic || '리포트'} · 생성 {formatDate(share.createdAt)}</div>
                      <div className="muted">만료 {formatDate(share.expiresAt)} · 조회 {share.accessCount || 0}회</div>
                    </div>
                    <div className="share-modal__item-actions">
                      <button className="ui-button ui-btn-secondary" onClick={() => copy(share.url || link, share.shareId)}>
                        {copiedKey === share.shareId ? <Check size={14} /> : <Copy size={14} />}
                        {copiedKey === share.shareId ? '복사됨' : '복사'}
                      </button>
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
