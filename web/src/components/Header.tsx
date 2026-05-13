import React from 'react'
import { BadgePercent, Command, Menu, UserRound, X } from 'lucide-react'
import { TELEGRAM_COMMANDS } from '../data/telegramCommands'
import { NAV_ITEMS, PRIMARY_NAV_KEYS } from '../navigation'
import ProfileModal from './ProfileModal'
import CreditShortForm from './CreditShortForm'
import { readProfile, type StoredProfile } from '../lib/userContext'
import { apiFetch } from '../lib/api'
import { onOpenProfileModal } from '../lib/profileModal'
import { useAuthStore } from '../stores/authStore'

type Props = {
  onNavigate: (r: string) => void
  activeRoute?: string
}

export default function Header({
  onNavigate,
  activeRoute,
}: Props){
  const { isSignedIn, isSigningIn, authEmail, authName, signIn, signOut } = useAuthStore()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [cmdOpen, setCmdOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [creditShortOpen, setCreditShortOpen] = React.useState(false)
  const [profile, setProfile] = React.useState<StoredProfile>(() => readProfile() ?? {})
  const [isAdmin, setIsAdmin] = React.useState(false)
  const [focusChatIdField, setFocusChatIdField] = React.useState(false)

  // 아바타 이니셜 계산
  const authLabel = authName || authEmail || ''
  const displayName = profile.nickname || profile.telegramName || authLabel
  const initials = displayName
    ? displayName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    : null
  const isTelegramLinked = !!profile.telegramId

  const cmdInputRef = React.useRef<HTMLInputElement | null>(null)

  const visible = TELEGRAM_COMMANDS.filter(c => c.cmd.includes(filter) || c.desc.includes(filter))

  const visibleNavGroups = React.useMemo(
    () => NAV_ITEMS
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.adminOnly || isAdmin),
      }))
      .filter((group) => group.items.length > 0),
    [isAdmin],
  )

  const allItems = React.useMemo(() => visibleNavGroups.flatMap(group => group.items), [visibleNavGroups])
  const primaryItems = React.useMemo(
    () => allItems.filter(item => PRIMARY_NAV_KEYS.includes(item.key as any)),
    [allItems],
  )

  React.useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  React.useEffect(() => {
    if (cmdOpen) {
      setTimeout(() => cmdInputRef.current?.focus(), 0)
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCmdOpen(false) }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
  }, [cmdOpen])

  React.useEffect(() => {
    if (drawerOpen || cmdOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [drawerOpen, cmdOpen])

  React.useEffect(() => {
    setProfile(readProfile() ?? {})
  }, [isSignedIn])

  const handleSaveCreditShort = React.useCallback(async (data: { rows: Array<{ code: string; date: string; shortRatio?: number; shortBalance?: number; shortVolume?: number }> }) => {
    const batchSize = Math.max(50, Number(import.meta.env.VITE_CREDIT_SHORT_UPLOAD_BATCH_SIZE || 250))
    const timeoutMs = Math.max(20_000, Number(import.meta.env.VITE_CREDIT_SHORT_UPLOAD_TIMEOUT_MS || 60_000))
    const rows = Array.isArray(data?.rows) ? data.rows : []

    let saved = 0
    let dropped = 0
    let updatedStocks = 0

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize)
      const json = await apiFetch('/api/credit-short', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs,
        body: JSON.stringify({ rows: chunk }),
      })

      if (!json?.success) {
        const batchNo = Math.floor(i / batchSize) + 1
        throw new Error(json?.error || `${batchNo}번 배치 저장 실패`)
      }

      saved += Number(json?.saved || 0)
      dropped += Number(json?.filteredOut || 0)
      updatedStocks += Number(json?.updatedStocks || 0)
    }

    return { saved, dropped, updatedStocks }
  }, [])

  // 대시보드에서 "Chat ID 연결" 버튼 클릭 시 프로필 모달 열기
  React.useEffect(() => {
    return onOpenProfileModal(() => {
      setProfileOpen(true)
      setFocusChatIdField(true)
    })
  }, [])

  React.useEffect(() => {
    let disposed = false

    const run = async () => {
      if (!isSignedIn) {
        if (!disposed) setIsAdmin(false)
        return
      }

      try {
        const json = await apiFetch('/api/ui/access-users?mode=me', { cacheMs: 0, timeoutMs: 10_000 })
        if (!disposed) setIsAdmin(!!json?.data?.is_admin)
      } catch {
        if (!disposed) setIsAdmin(false)
      }
    }

    void run()
    return () => {
      disposed = true
    }
  }, [isSignedIn])

  return (
    <>
    <header className="site-header">
      <div className="header-inner">
        <div className="brand">
          <button className="brand-btn" onClick={() => { onNavigate('dashboard'); setDrawerOpen(false) }}>Nexora</button>
        </div>

        <div className="top-nav" role="navigation" aria-label="핵심 네비게이션">
          <div className="top-nav-list">
            {primaryItems.map(item => (
              <button
                key={item.key}
                className={`nav-item${activeRoute === item.key ? ' active' : ''}`}
                onClick={() => onNavigate(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            className="nav-item top-nav-action"
            onClick={() => setCmdOpen(true)}
            aria-label="명령 목록 열기"
          >
            <Command className="top-nav-action-icon" aria-hidden />
            <span className="top-nav-action-label">명령</span>
          </button>
          <button
            className="nav-item top-nav-action"
            onClick={() => setCreditShortOpen(true)}
            title="공매도 지표 수동 입력"
            aria-label="공매도 지표 입력"
          >
            <BadgePercent className="top-nav-action-icon" aria-hidden />
            <span className="top-nav-action-label">공매도</span>
          </button>
          {/* 프로필 아바타 버튼 */}
          <button
            className={`profile-avatar-btn${isTelegramLinked ? ' profile-avatar-btn--connected' : ''}`}
            onClick={() => setProfileOpen(true)}
            aria-label="내 프로필"
            title={displayName || '프로필 설정'}
          >
            {initials || (
              <UserRound size={16} aria-hidden />
            )}
          </button>
          <button
            className="nav-toggle"
            aria-expanded={drawerOpen}
            aria-label="전체 메뉴"
            onClick={() => setDrawerOpen(v => !v)}
          >
            <Menu size={18} aria-hidden />
          </button>
        </div>
      </div>

      {drawerOpen && (
        <div className="nav-drawer-overlay" role="dialog" aria-modal aria-label="전체 메뉴" onClick={() => setDrawerOpen(false)}>
          <aside className="nav-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="nav-drawer-header">
              <div className="nav-drawer-title">메뉴</div>
              <button
                className="nav-drawer-close"
                aria-label="메뉴 닫기"
                onClick={() => setDrawerOpen(false)}
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="nav-drawer-content">
              {visibleNavGroups.map((group) => (
                <div key={group.category} className="nav-group">
                  <div className="nav-group-title">{group.category}</div>
                  <div className="nav-group-items">
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        role="menuitem"
                        className={`nav-item${activeRoute === item.key ? ' active' : ''}${PRIMARY_NAV_KEYS.includes(item.key as any) ? ' nav-drawer-primary-item' : ''}`}
                        onClick={() => {
                          if ((item as any).type === 'commands') {
                            setCmdOpen(true)
                          } else {
                            onNavigate(item.key)
                          }
                          setDrawerOpen(false)
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      {cmdOpen && (
        <div className="modal-overlay" role="dialog" aria-modal aria-label="텔레그램 명령 모달">
          <div className="modal card">
            <div className="flex-between">
              <h2 className="title-lg">텔레그램 명령</h2>
              <button className="nav-item" onClick={() => setCmdOpen(false)}>닫기</button>
            </div>
            <div className="mt-2">
              <input ref={cmdInputRef} placeholder="검색(cmd or 설명)" value={filter} onChange={(e) => setFilter(e.target.value)} className="ui-text" />
            </div>
            <div className="mt-3" style={{maxHeight: '60vh', overflow: 'auto'}}>
              {visible.map(c => (
                <div key={c.cmd} className="card" style={{marginBottom: 8}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <div>
                      <div style={{fontWeight:600}}>{c.cmd}</div>
                      <div className="muted" style={{fontSize:12}}>{c.desc}</div>
                    </div>
                    <div>
                      <button className="ui-button ui-btn-secondary" onClick={() => { navigator.clipboard?.writeText(c.cmd) }}>복사</button>
                    </div>
                  </div>
                </div>
              ))}
              {visible.length === 0 && (
                <div className="muted">검색 결과가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
    <ProfileModal
      isOpen={profileOpen}
      onClose={() => { setProfileOpen(false); setFocusChatIdField(false) }}
      onSaved={p => setProfile(prev => ({ ...prev, ...p }))}
      isSignedIn={isSignedIn}
      authEmail={authEmail}
      authName={authName}
      onSignIn={signIn}
      onSignOut={signOut}
      isSigningIn={isSigningIn}
      focusChatIdField={focusChatIdField}
    />
    <CreditShortForm
      isOpen={creditShortOpen}
      onClose={() => setCreditShortOpen(false)}
      onSave={handleSaveCreditShort}
    />
      </>
    )
}
