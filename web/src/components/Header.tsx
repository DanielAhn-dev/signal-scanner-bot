import React from 'react'
import { TELEGRAM_COMMANDS } from '../data/telegramCommands'
import { NAV_ITEMS, PRIMARY_NAV_KEYS } from '../navigation'
import ProfileModal from './ProfileModal'
import { readProfile, type StoredProfile } from '../lib/userContext'

type Props = { onNavigate: (r: string) => void; activeRoute?: string }

export default function Header({ onNavigate, activeRoute }: Props){
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [cmdOpen, setCmdOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [profile, setProfile] = React.useState<StoredProfile>(() => readProfile() ?? {})

  // 아바타 이니셜 계산
  const displayName = profile.nickname || profile.telegramName || ''
  const initials = displayName
    ? displayName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    : null
  const isConnected = !!profile.telegramId

  const cmdInputRef = React.useRef<HTMLInputElement | null>(null)

  const visible = TELEGRAM_COMMANDS.filter(c => c.cmd.includes(filter) || c.desc.includes(filter))

  const allItems = React.useMemo(() => NAV_ITEMS.flatMap(group => group.items), [])
  const primaryItems = React.useMemo(
    () => allItems.filter(item => PRIMARY_NAV_KEYS.includes(item.key as any)),
    [allItems],
  )

  React.useEffect(() => {
    if (cmdOpen) {
      // focus the search input when modal opens
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

  return (
    <>
    <header className="site-header">
      <div className="header-inner">
        <div className="brand">
          <button className="brand-btn" onClick={() => { onNavigate('dashboard'); setDrawerOpen(false) }}>Signal Scanner</button>
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
          >
            명령
          </button>
          {/* 프로필 아바타 버튼 */}
          <button
            className={`profile-avatar-btn${isConnected ? ' profile-avatar-btn--connected' : ''}`}
            onClick={() => setProfileOpen(true)}
            aria-label="내 프로필"
            title={displayName || '프로필 설정'}
          >
            {initials || (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            )}
            {!isConnected && <span className="profile-avatar-dot" aria-hidden />}
          </button>
          <button
            className="nav-toggle"
            aria-expanded={drawerOpen}
            aria-label="전체 메뉴"
            onClick={() => setDrawerOpen(v => !v)}
          >
            <svg width="20" height="14" viewBox="0 0 20 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <rect y="1" width="20" height="2" rx="1" fill="currentColor" />
              <rect y="6" width="20" height="2" rx="1" fill="currentColor" />
              <rect y="11" width="20" height="2" rx="1" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {drawerOpen && (
        <div className="nav-drawer-overlay" role="dialog" aria-modal aria-label="전체 메뉴" onClick={() => setDrawerOpen(false)}>
          <aside className="nav-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="nav-drawer-header">
              <div className="nav-drawer-title">전체 메뉴</div>
              <button className="nav-item" onClick={() => setDrawerOpen(false)}>닫기</button>
            </div>
            <div className="nav-drawer-content">
              {NAV_ITEMS.map((group) => (
                <div key={group.category} className="nav-group">
                  <div className="nav-group-title">{group.category}</div>
                  <div className="nav-group-items">
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        role="menuitem"
                        className={`nav-item${activeRoute === item.key ? ' active' : ''}`}
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
      onClose={() => setProfileOpen(false)}
      onSaved={p => setProfile(prev => ({ ...prev, ...p }))}
    />
      </>
    )
}
