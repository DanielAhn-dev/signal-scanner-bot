import React, { useEffect, useRef, useState } from 'react'
import { getFixedAllowedChatId, readProfile, saveProfile, clearProfile, type StoredProfile } from '../lib/userContext'
import { invalidateCache } from '../lib/api'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** 저장 성공 시 헤더 등 외부 상태 갱신용 */
  onSaved?: (profile: StoredProfile) => void
}

const STATUS_IDLE    = 'idle'
const STATUS_LOADING = 'loading'
const STATUS_OK      = 'ok'
const STATUS_ERR     = 'error'

type VerifyStatus = typeof STATUS_IDLE | typeof STATUS_LOADING | typeof STATUS_OK | typeof STATUS_ERR

export default function ProfileModal({ isOpen, onClose, onSaved }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const fixedChatId = getFixedAllowedChatId()

  const [telegramId, setTelegramId] = useState('')
  const [nickname, setNickname]     = useState('')
  const [tgName, setTgName]         = useState('')       // fetched from Telegram API
  const [tgUsername, setTgUsername] = useState('')

  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>(STATUS_IDLE)
  const [verifyMsg, setVerifyMsg]       = useState('')
  const [saving, setSaving]             = useState(false)
  const [saveMsg, setSaveMsg]           = useState('')

  /* ── 열릴 때 localStorage에서 현재 값 로드 ── */
  useEffect(() => {
    if (!isOpen) return
    const p = readProfile()
    setTelegramId(fixedChatId || (p?.telegramId ?? ''))
    setNickname(p?.nickname ?? '')
    setTgName(p?.telegramName ?? '')
    setTgUsername(p?.telegramUsername ?? '')
    setVerifyStatus((fixedChatId || p?.telegramId) ? STATUS_OK : STATUS_IDLE)
    setVerifyMsg('')
    setSaveMsg('')
  }, [isOpen, fixedChatId])

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
    if (fixedChatId) {
      setVerifyStatus(STATUS_OK)
      setVerifyMsg('고정 Chat ID 정책이 적용되어 있습니다.')
      return
    }

    const id = telegramId.trim().replace(/[^0-9-]/g, '')
    if (!id) { setVerifyMsg('텔레그램 Chat ID를 입력해 주세요.'); setVerifyStatus(STATUS_ERR); return }
    setVerifyStatus(STATUS_LOADING)
    setVerifyMsg('')
    try {
      const res = await fetch(`/api/getTelegramProfile?chatId=${encodeURIComponent(id)}`, {
        headers: { 'x-internal-secret': '' },
      })
      const json = await res.json()
      if (!res.ok || json?.error) {
        setVerifyStatus(STATUS_ERR)
        setVerifyMsg(json?.error || '조회 실패 — Chat ID를 다시 확인해 주세요.')
        return
      }
      const name = [json.first_name, json.last_name].filter(Boolean).join(' ')
      setTgName(name)
      setTgUsername(json.username ?? '')
      setVerifyStatus(STATUS_OK)
      setVerifyMsg(`✓ ${name}${json.username ? ' (@' + json.username + ')' : ''} 확인 완료`)
    } catch (e: any) {
      setVerifyStatus(STATUS_ERR)
      setVerifyMsg('네트워크 오류: ' + (e?.message ?? String(e)))
    }
  }

  /* ── 저장 ── */
  const handleSave = () => {
    setSaving(true)
    setSaveMsg('')
    const patch: StoredProfile = {
      telegramId:       telegramId.trim().replace(/[^0-9-]/g, '') || undefined,
      nickname:         nickname.trim() || undefined,
      telegramName:     tgName || undefined,
      telegramUsername: tgUsername || undefined,
    }
    try {
      saveProfile(patch)
      invalidateCache()            // API 캐시 무효화 → chatId 변경 반영
      setSaveMsg('저장됐습니다.')
      onSaved?.(patch)
      setTimeout(onClose, 800)
    } catch {
      setSaveMsg('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  /* ── 연동 해제 ── */
  const handleClear = () => {
    clearProfile()
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

  const isConnected = verifyStatus === STATUS_OK && !!telegramId.trim()

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
          <label className="profile-field-label">Chat ID</label>
          <div className="profile-field-row">
            <input
              className="ui-text"
              placeholder="예: 123456789"
              value={fixedChatId || telegramId}
              onChange={e => {
                setTelegramId(e.target.value)
                setVerifyStatus(STATUS_IDLE)
                setVerifyMsg('')
              }}
              inputMode="numeric"
              readOnly={!!fixedChatId}
            />
            <button
              className={`ui-button${verifyStatus === STATUS_LOADING ? ' ui-btn-secondary' : ' ui-btn-primary'}`}
              style={{ whiteSpace: 'nowrap' }}
              onClick={handleVerify}
              disabled={verifyStatus === STATUS_LOADING || !!fixedChatId}
            >
              {verifyStatus === STATUS_LOADING ? '확인 중…' : '확인'}
            </button>
          </div>

          {fixedChatId && (
            <p className="profile-hint">고정 Chat ID 정책이 적용되어 Chat ID를 변경할 수 없습니다.</p>
          )}

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
            disabled={saving}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
