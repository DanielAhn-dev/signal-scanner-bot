import Detail from '../../components/ui/Detail'
import React from 'react'
import { useToast } from '../../components/ToastProvider'
import { linkedTelegramId, normalizeTelegramChatId } from '../../lib/userContext'
import { useAuthStore } from '../../stores/authStore'
import { useProfileStore } from '../../stores/profileStore'
import { apiFetch } from '../../lib/api'
import { PushNotificationToggle } from '../../components/PushNotificationToggle'
import InviteCard from '../invites/InviteCard'

const STATUS_IDLE    = 'idle'
const STATUS_LOADING = 'loading'
const STATUS_OK      = 'ok'
const STATUS_ERR     = 'error'

type VerifyStatus = typeof STATUS_IDLE | typeof STATUS_LOADING | typeof STATUS_OK | typeof STATUS_ERR

// 헤더의 ProfileModal과 동일한 useProfileStore(서버 동기화)를 사용한다.
// 예전에는 이 페이지가 별도 localStorage['profile']을 자체 스키마로 썼는데,
// ProfileModal/설정 페이지가 쓰는 같은 키를 다른 스키마로 덮어써서
// 로그인/새로고침마다 서로의 저장값을 지우는 문제가 있었다.
export default function ProfilePage(){
  const toast = useToast()
  const { isSignedIn, authEmail, authName } = useAuthStore()
  const profile = useProfileStore((s) => s.profile)
  const syncError = useProfileStore((s) => s.syncError)
  const setProfile = useProfileStore((s) => s.setProfile)
  const clearState = useProfileStore((s) => s.clearState)

  const [telegramId, setTelegramId] = React.useState('')
  const [nickname, setNickname]     = React.useState('')
  const [tgName, setTgName]         = React.useState('')
  const [tgUsername, setTgUsername] = React.useState('')

  const [verifyStatus, setVerifyStatus] = React.useState<VerifyStatus>(STATUS_IDLE)
  const [verifyMsg, setVerifyMsg]       = React.useState('')
  const [saving, setSaving]             = React.useState(false)
  const [saveMsg, setSaveMsg]           = React.useState('')

  React.useEffect(() => {
    setTelegramId(linkedTelegramId(profile))
    setNickname(profile?.nickname ?? '')
    setTgName(profile?.telegramName ?? '')
    setTgUsername(profile?.telegramUsername ?? '')
    setVerifyStatus(linkedTelegramId(profile) ? STATUS_OK : STATUS_IDLE)
  }, [profile])

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
      setVerifyMsg(`${name || '사용자'}${json?.username ? ' (@' + json.username + ')' : ''} 확인 완료`)
    } catch (e: any) {
      setVerifyStatus(STATUS_ERR)
      setVerifyMsg('네트워크 오류: ' + (e?.message ?? String(e)))
    }
  }

  const handleSave = async () => {
    if (!isSignedIn) {
      setSaveMsg('Google 로그인 후 저장할 수 있습니다.')
      return
    }
    setSaving(true)
    setSaveMsg('')
    const nextTelegramId = normalizeTelegramChatId(telegramId)
    try {
      const result = await setProfile({
        telegramId: nextTelegramId || undefined,
        nickname: nickname.trim() || undefined,
        telegramName: tgName || undefined,
        telegramUsername: tgUsername || undefined,
      })
      if (!result.synced) {
        setSaveMsg(`저장 실패: ${result.error || '서버 프로필 저장에 실패했습니다.'}`)
        return
      }
      setSaveMsg('저장됐습니다.')
      toast.show('프로필이 저장되었습니다')
    } catch {
      setSaveMsg('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    clearState()
    setTelegramId('')
    setNickname('')
    setTgName('')
    setTgUsername('')
    setVerifyStatus(STATUS_IDLE)
    setVerifyMsg('')
    setSaveMsg('')
    toast.show('프로필을 초기화했습니다')
  }

  const displayName = nickname.trim() || tgName || authName || '?'
  const isConnected = isSignedIn && verifyStatus === STATUS_OK && !!normalizeTelegramChatId(telegramId)

  return (
    <div className="profile-page max-w-3xl">
      <h2 className="title-xl">프로필</h2>

      <div className="card mb-4">
        <div className="ui-field">
          <label className="ui-label">Google 계정</label>
          {isSignedIn ? (
            <>
              <div className="muted">{authName || '이름 정보 없음'}</div>
              <div className="muted">{authEmail || '이메일 정보 없음'}</div>
              <Detail><div className="muted mt-1">메인 로그인은 Google 계정이며, 텔레그램은 알림용 보조 연결입니다.</div></Detail>
            </>
          ) : (
            <div className="muted">Google 로그인 상태를 확인할 수 없습니다.</div>
          )}
        </div>
      </div>

      {isSignedIn && !!syncError && (
        <div className="card mb-4">
          <div className="muted" style={{ color: 'var(--color-stock-up, #F04452)' }}>
            프로필 동기화 오류: {syncError}
          </div>
        </div>
      )}

      <div className="card mb-4">
        <section className="profile-section">
          <div className="profile-section-title">기본 정보</div>
          <label className="profile-field-label">닉네임</label>
          <input
            className="ui-text"
            placeholder="표시될 이름을 입력하세요"
            value={nickname}
            maxLength={20}
            onChange={(e) => setNickname(e.target.value)}
          />
          <Detail><p className="profile-hint">앱 내에서만 사용되며, 텔레그램 이름과 별개입니다.</p></Detail>
        </section>
      </div>

      <div className="card mb-4">
        <section className="profile-section">
          <div className="profile-section-title">텔레그램 연동</div>
          <Detail>
          <p className="profile-hint">
            텔레그램 봇에서 <strong>/내정보</strong> 또는 <strong>/start</strong> 명령을 보내면
            Chat ID를 확인할 수 있습니다.
          </p>
          <p className="profile-hint" style={{ marginTop: 6 }}>
            선택 입력 항목입니다. 웹 기본 기능은 Chat ID 없이도 사용할 수 있습니다.
          </p>
          </Detail>
          <label className="profile-field-label">Chat ID</label>
          <div className="profile-field-row">
            <input
              className="ui-text"
              placeholder="예: 123456789"
              value={telegramId}
              disabled={!isSignedIn}
              onChange={(e) => {
                setTelegramId(e.target.value)
                setVerifyStatus(STATUS_IDLE)
                setVerifyMsg('')
              }}
              inputMode="numeric"
            />
            <button
              className="ui-button ui-btn-ghost"
              onClick={handleVerify}
              disabled={!isSignedIn || !telegramId || verifyStatus === STATUS_LOADING}
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
        </section>

        <section className="profile-section">
          <div className="profile-section-title">알림</div>
          <PushNotificationToggle isSignedIn={isSignedIn} />
        </section>

        {isSignedIn && <InviteCard />}
      </div>

      <div className="card mb-4">
        {saveMsg && <p className="profile-save-msg">{saveMsg}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ui-button ui-btn-primary" onClick={handleSave} disabled={!isSignedIn || saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
          <button className="ui-button ui-btn-ghost" onClick={handleReset}>초기화</button>
        </div>
      </div>
    </div>
  )
}
