import React, { useEffect, useRef, useState } from 'react'
import { normalizeTelegramChatId, type StoredProfile } from '../lib/userContext'
import { invalidateCache } from '../lib/api'
import { useToast } from './ToastProvider'
import { apiFetch } from '../lib/api'
import { useProfileStore } from '../stores/profileStore'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** 저장 성공 시 헤더 등 외부 상태 갱신용 */
  onSaved?: (profile: StoredProfile) => void
  isSignedIn: boolean
  authEmail?: string
  authName?: string
  onSignIn: () => void
  onSignOut: () => void
  isSigningIn?: boolean
  /** Chat ID 필드로 포커스 여부 */
  focusChatIdField?: boolean
}

const STATUS_IDLE    = 'idle'
const STATUS_LOADING = 'loading'
const STATUS_OK      = 'ok'
const STATUS_ERR     = 'error'

type VerifyStatus = typeof STATUS_IDLE | typeof STATUS_LOADING | typeof STATUS_OK | typeof STATUS_ERR

export default function ProfileModal({
  isOpen,
  onClose,
  onSaved,
  isSignedIn,
  authEmail,
  authName,
  onSignIn,
  onSignOut,
  isSigningIn,
  focusChatIdField,
}: Props) {
  const profile = useProfileStore((state) => state.profile)
  const syncError = useProfileStore((state) => state.syncError)
  const setProfile = useProfileStore((state) => state.setProfile)
  const clearState = useProfileStore((state) => state.clearState)
  const overlayRef = useRef<HTMLDivElement>(null)
  const chatIdInputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  const [telegramId, setTelegramId] = useState('')
  const [nickname, setNickname]     = useState('')
  const [tgName, setTgName]         = useState('')       // fetched from Telegram API
  const [tgUsername, setTgUsername] = useState('')

  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>(STATUS_IDLE)
  const [verifyMsg, setVerifyMsg]       = useState('')
  const [saving, setSaving]             = useState(false)
  const [saveMsg, setSaveMsg]           = useState('')
  const [autoResolved, setAutoResolved] = useState(false)

  /* ── 열릴 때 localStorage에서 현재 값 로드 ── */
  useEffect(() => {
    if (!isOpen) return
    setTelegramId(profile?.telegramId ?? '')
    setNickname(profile?.nickname ?? '')
    setTgName(profile?.telegramName ?? '')
    setTgUsername(profile?.telegramUsername ?? '')
    setVerifyStatus(profile?.telegramId ? STATUS_OK : STATUS_IDLE)
    setVerifyMsg(syncError ? `프로필 동기화 오류: ${syncError}` : '')
    setSaveMsg(syncError ? '서버 프로필 동기화 상태를 확인해 주세요.' : '')
    setAutoResolved(false)
    
    // Chat ID 필드로 포커스 이동
    if (focusChatIdField) {
      setTimeout(() => chatIdInputRef.current?.focus(), 100)
    }
  }, [isOpen, focusChatIdField, profile, syncError])

  useEffect(() => {
    if (!isOpen || !isSignedIn) return
    const normalized = normalizeTelegramChatId(telegramId)
    if (!normalized) return
    if (autoResolved) return

    let disposed = false
    const run = async () => {
      try {
        setVerifyStatus(STATUS_LOADING)
        const json = await apiFetch(`/api/ui/telegram-profile?chatId=${encodeURIComponent(normalized)}`, {
          cacheMs: 15_000,
          timeoutMs: 10_000,
          retries: 0,
        })
        if (disposed) return
        const name = [json?.first_name, json?.last_name].filter(Boolean).join(' ').trim()
        if (name) setTgName(name)
        if (json?.username) setTgUsername(String(json.username))
        setVerifyStatus(STATUS_OK)
        setVerifyMsg(name ? `✓ ${name}${json?.username ? ` (@${json.username})` : ''}` : '연동 정보 확인 완료')
      } catch {
        if (disposed) return
        setVerifyStatus(STATUS_IDLE)
        setVerifyMsg('')
      } finally {
        if (!disposed) setAutoResolved(true)
      }
    }
    void run()

    return () => {
      disposed = true
    }
  }, [isOpen, isSignedIn, telegramId, autoResolved])

  /* ── ESC 닫기 ── */
  useEffect(() => {
    if (!isOpen) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', h)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  /* ── 텔레그램 ID 검증 ── */
  const handleVerify = async () => {
    if (!isSignedIn) {
      setVerifyStatus(STATUS_ERR)
      setVerifyMsg('Google 로그인 후 텔레그램 연동을 진행해 주세요.')
      return
    }
    const id = normalizeTelegramChatId(telegramId)
    if (!id) { setVerifyMsg('숫자 Chat ID를 입력해 주세요.'); setVerifyStatus(STATUS_ERR); return }
    setVerifyStatus(STATUS_LOADING)
    setVerifyMsg('')
    try {
      const json = await apiFetch(`/api/ui/telegram-profile?chatId=${encodeURIComponent(id)}`, {
        cacheMs: 0,
        timeoutMs: 10_000,
        retries: 0,
      })
      if (json?.error) {
        setVerifyStatus(STATUS_ERR)
        setVerifyMsg(json?.error || '조회 실패 — Chat ID를 다시 확인해 주세요.')
        return
      }
      const name = [json?.first_name, json?.last_name].filter(Boolean).join(' ').trim()
      setTgName(name)
      setTgUsername(json?.username ?? '')
      setVerifyStatus(STATUS_OK)
      setVerifyMsg(`✓ ${name || '사용자'}${json?.username ? ' (@' + json.username + ')' : ''} 확인 완료`)
      setAutoResolved(true)
    } catch (e: any) {
      setVerifyStatus(STATUS_ERR)
      setVerifyMsg('네트워크 오류: ' + (e?.message ?? String(e)))
    }
  }

  /* ── 저장 ── */
  const handleSave = async () => {
    if (!isSignedIn) {
      setSaveMsg('Google 로그인 후 저장할 수 있습니다.')
      return
    }
    setSaving(true)
    setSaveMsg('')
    const previousTelegramId = normalizeTelegramChatId(profile?.telegramId)
    const nextTelegramId = normalizeTelegramChatId(telegramId)
    const patch: StoredProfile = {
      telegramId:       nextTelegramId || undefined,
      nickname:         nickname.trim() || undefined,
      telegramName:     tgName || undefined,
      telegramUsername: tgUsername || undefined,
    }
    try {
      const result = await setProfile(patch)
      if (!result.synced) {
        setSaveMsg(`저장 실패: ${result.error || '서버 프로필 저장에 실패했습니다.'}`)
        return
      }
      invalidateCache()            // API 캐시 무효화 → chatId 변경 반영
      setSaveMsg('저장됐습니다.')
      const firstLinked = !previousTelegramId && !!patch.telegramId
      if (firstLinked) {
        toast.show('텔레그램 연동 완료: 알림 전송/텔레그램 연동 기능에 사용됩니다.')
      }
      onSaved?.(result.profile)
      setTimeout(onClose, 800)
    } catch {
      setSaveMsg('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  /* ── 연동 해제 ── */
  const handleClear = () => {
    clearState()
    setTelegramId('')
    setNickname('')
    setTgName('')
    setTgUsername('')
    setVerifyStatus(STATUS_IDLE)
    setVerifyMsg('')
    setSaveMsg('프로필이 초기화됐습니다.')
    invalidateCache()
    onSaved?.({})
  }

  /* ── 아바타 이니셜 ── */
  const displayName = nickname.trim() || tgName || '?'
  const initials = displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const isConnected = isSignedIn && verifyStatus === STATUS_OK && !!normalizeTelegramChatId(telegramId)

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
    >
      <div className="modal profile-modal">
        {/* ── 헤더 ── */}
        <div className="modal-header">
          <h2 className="modal-title" id="profile-modal-title">내 프로필</h2>
          <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        {/* ── 아바타 ── */}
        <div className="profile-avatar-wrap">
          <div className={`profile-avatar${isConnected ? ' profile-avatar--connected' : ''}`}>
            {initials}
          </div>
          {isConnected && (
            <span className="profile-badge-connected">연동됨</span>
          )}
        </div>

        {/* ── 섹션: 기본 정보 ── */}
        <section className="profile-section">
          <div className="profile-section-title">계정</div>
          {isSignedIn ? (
            <>
              <p className="profile-hint" style={{ marginBottom: 8 }}>
                Google 계정으로 로그인됨
              </p>
              <p className="profile-hint" style={{ marginBottom: 10 }}>
                {authName ? `${authName} · ` : ''}{authEmail || '이메일 정보 없음'}
              </p>
              <button className="ui-button ui-btn-ghost" onClick={onSignOut}>로그아웃</button>
            </>
          ) : (
            <>
              <p className="profile-hint" style={{ marginBottom: 10 }}>
                로그인 전에는 웹 페이지 접근이 제한됩니다. Google 로그인 후 이용해 주세요.
              </p>
              <button className="ui-button ui-btn-primary" onClick={onSignIn} disabled={!!isSigningIn}>
                {isSigningIn ? '로그인 중…' : 'Google 로그인'}
              </button>
            </>
          )}
        </section>

        {/* ── 섹션: 기본 정보 ── */}
        <section className="profile-section">
          <div className="profile-section-title">기본 정보</div>
          <label className="profile-field-label">닉네임</label>
          <input
            className="ui-text"
            placeholder="표시될 이름을 입력하세요"
            value={nickname}
            maxLength={20}
            onChange={e => setNickname(e.target.value)}
          />
          <p className="profile-hint">앱 내에서만 사용되며, 텔레그램 이름과 별개입니다.</p>
        </section>

        {/* ── 섹션: 텔레그램 연동 ── */}
        <section className="profile-section">
          <div className="profile-section-title">텔레그램 연동</div>
          <p className="profile-hint">
            텔레그램 봇에서 <strong>/내정보</strong> 또는 <strong>/start</strong> 명령을 보내면
            Chat ID를 확인할 수 있습니다.
          </p>
          <p className="profile-hint" style={{ marginTop: 6 }}>
            선택 입력 항목입니다. 웹 기본 기능은 Chat ID 없이도 사용할 수 있습니다.
          </p>
          <label className="profile-field-label">Chat ID</label>
          <div className="profile-field-row">
            <input
              ref={chatIdInputRef}
              className="ui-text"
              placeholder="예: 123456789"
              value={telegramId}
              disabled={!isSignedIn}
              onChange={e => {
                setTelegramId(e.target.value)
                setVerifyStatus(STATUS_IDLE)
                setVerifyMsg('')
              }}
              inputMode="numeric"
            />
            <button
              className={`ui-button${verifyStatus === STATUS_LOADING ? ' ui-btn-secondary' : ' ui-btn-primary'}`}
              style={{ whiteSpace: 'nowrap' }}
              onClick={handleVerify}
              disabled={!isSignedIn || verifyStatus === STATUS_LOADING}
            >
              {verifyStatus === STATUS_LOADING ? '확인 중…' : '확인'}
            </button>
          </div>

          {verifyMsg && (
            <p className={`profile-verify-msg${verifyStatus === STATUS_ERR ? ' profile-verify-msg--err' : ' profile-verify-msg--ok'}`}>
              {verifyMsg}
            </p>
          )}

          {isConnected && (
            <div className="profile-tg-info">
              <span className="profile-tg-icon">✈</span>
              <span>{tgName}{tgUsername && <span className="muted"> @{tgUsername}</span>}</span>
            </div>
          )}

          <details style={{ marginTop: 10 }}>
            <summary className="profile-hint" style={{ cursor: 'pointer' }}>연동 가이드 / 자주 겪는 오류</summary>
            <div className="profile-hint" style={{ marginTop: 8 }}>
              1) 텔레그램 봇에서 /start 실행 후 받은 Chat ID를 붙여넣어 주세요.<br />
              2) Chat ID는 숫자만 입력해도 됩니다. (공백/문자는 자동 정리)<br />
              3) 조회 실패 시 먼저 텔레그램에서 봇과 대화를 시작했는지 확인해 주세요.
            </div>
          </details>
        </section>

        {/* ── 저장 메시지 ── */}
        {saveMsg && <p className="profile-save-msg">{saveMsg}</p>}

        {/* ── 하단 버튼 ── */}
        <div className="profile-actions">
          <button className="ui-button ui-btn-ghost" onClick={handleClear}>
            초기화
          </button>
          <button
            className="ui-button ui-btn-primary"
            onClick={handleSave}
            disabled={!isSignedIn || saving}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
