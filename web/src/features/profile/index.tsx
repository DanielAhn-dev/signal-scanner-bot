import React from 'react'
import { useToast } from '../../components/ToastProvider'
import { normalizeTelegramChatId } from '../../lib/userContext'
import { useAuthStore } from '../../stores/authStore'

type Profile = {
  fullName: string
  email: string
  telegramId?: string
  notifications: boolean
  apiKey?: string
  avatar?: string | null
}

const DEFAULT: Profile = {
  fullName: '',
  email: 'user@example.com',
  telegramId: '',
  notifications: true,
  apiKey: '',
  avatar: null
}

const STORAGE_KEY = 'profile'

export default function ProfilePage(){
  const toast = useToast()
  const { isSignedIn, authEmail, authName } = useAuthStore()
  const [profile, setProfile] = React.useState<Profile>(DEFAULT)
  const [showApi, setShowApi] = React.useState(false)

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setProfile(JSON.parse(raw))
    } catch (e) {
      // ignore
    }
  }, [])

  const update = (patch: Partial<Profile>) => setProfile(p => ({...p, ...patch}))

  const handleAvatar = (f?: File) => {
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => update({ avatar: reader.result as string })
    reader.readAsDataURL(f)
  }

  const save = () => {
    if (!profile.fullName) return toast.show('이름을 입력하세요')
    const telegramId = normalizeTelegramChatId(profile.telegramId)
    if (profile.telegramId && !telegramId) {
      return toast.show('텔레그램 Chat ID는 숫자만 입력해 주세요')
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...profile, telegramId: telegramId || undefined }))
    toast.show('프로필이 저장되었습니다')
  }

  const reset = () => {
    setProfile(DEFAULT)
    localStorage.removeItem(STORAGE_KEY)
    toast.show('프로필을 초기화했습니다')
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'profile.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const [tgLoading, setTgLoading] = React.useState(false)
  const [tgError, setTgError] = React.useState<string | null>(null)
  const [fetchedTg, setFetchedTg] = React.useState<any | null>(null)

  const fetchTelegramProfile = async (id: string) => {
    const telegramId = normalizeTelegramChatId(id)
    if (!telegramId) {
      setTgError('숫자 Chat ID를 입력해 주세요')
      toast.show('숫자 Chat ID를 입력해 주세요')
      return
    }
    setTgLoading(true)
    setTgError(null)
    setFetchedTg(null)
    try {
      const res = await fetch(`/api/ui?route=telegram-profile&chatId=${encodeURIComponent(telegramId)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'failed')
      }
      const data = await res.json()
      setFetchedTg(data)
      if (data?.source === 'users') {
        toast.show('DB에서 사용자 정보를 불러왔습니다')
      } else {
        toast.show('텔레그램 프로필을 불러왔습니다')
      }
    } catch (e: any) {
      setTgError(String(e?.message || e))
      toast.show('텔레그램 프로필 불러오기 실패')
    } finally {
      setTgLoading(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <h2 className="title-xl">프로필</h2>
      <div className="card mb-4">
        <div className="ui-field">
          <label className="ui-label">Google 계정</label>
          {isSignedIn ? (
            <>
              <div className="muted">{authName || '이름 정보 없음'}</div>
              <div className="muted">{authEmail || '이메일 정보 없음'}</div>
              <div className="muted mt-1">메인 로그인은 Google 계정이며, 텔레그램은 알림용 보조 연결입니다.</div>
            </>
          ) : (
            <div className="muted">Google 로그인 상태를 확인할 수 없습니다.</div>
          )}
        </div>
      </div>
      <div className="card mb-4">
        <div style={{display:'flex', gap: 16, alignItems:'center'}}>
          <div style={{width:96, height:96, borderRadius:12, overflow:'hidden', background:'#f3f4f6'}}>
            {profile.avatar ? (
              <img alt="avatar" src={profile.avatar} style={{width:'100%', height:'100%', objectFit:'cover'}} />
            ) : (
              <div style={{width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#6b7280'}}>아바타</div>
            )}
          </div>
          <div style={{flex:1}}>
            <div className="ui-field">
              <label className="ui-label">이름</label>
              <input className="ui-text" value={profile.fullName} onChange={(e) => update({ fullName: e.target.value })} />
            </div>
            <div className="ui-field mt-1">
              <label className="ui-label">이메일</label>
              <input className="ui-text" value={profile.email} onChange={(e) => update({ email: e.target.value })} />
            </div>
            <div style={{marginTop:8}}>
              <label className="ui-label">아바타 업로드</label>
              <input type="file" accept="image/*" onChange={(e) => handleAvatar(e.target.files?.[0])} />
            </div>
          </div>
        </div>
      </div>

      <div className="card mb-4">
            <div className="ui-field">
              <label className="ui-label">텔레그램 알림용 Chat ID</label>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <input className="ui-text" value={profile.telegramId} onChange={(e) => update({ telegramId: e.target.value })} placeholder="예: 123456789" />
                <button className="ui-button ui-btn-ghost" onClick={() => fetchTelegramProfile(profile.telegramId || '')} disabled={!profile.telegramId || tgLoading}>선택적 확인</button>
              </div>
              <div className="muted mt-1">웹 기본 기능은 Google 로그인으로 동작하고, 텔레그램 ID는 알림 전송에만 사용합니다.</div>
              {tgLoading && <div className="muted mt-1">불러오는 중…</div>}
              {tgError && <div className="muted mt-1">에러: {tgError}</div>}
              {fetchedTg && (
                <div style={{marginTop:8}}>
                  <div><strong>이름:</strong> {fetchedTg.first_name || '-'} {fetchedTg.last_name || ''}</div>
                  <div><strong>유저네임:</strong> {fetchedTg.username || '-'}</div>
                  <div><strong>타입:</strong> {fetchedTg.type}</div>
                </div>
              )}
            </div>
        <div className="ui-field mt-1">
          <label className="ui-label">알림</label>
          <div style={{display:'flex', gap:12, alignItems:'center'}}>
            <label style={{display:'flex', alignItems:'center', gap:8}}>
              <input type="checkbox" checked={profile.notifications} onChange={(e) => update({ notifications: e.target.checked })} />
              <span className="muted">텔레그램으로 알림 전송</span>
            </label>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="ui-field">
          <label className="ui-label">API 키</label>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            <input className="ui-text" value={showApi ? (profile.apiKey || '') : (profile.apiKey ? '••••••••••' : '')} onChange={(e) => update({ apiKey: e.target.value })} />
            <button className="ui-button ui-btn-ghost" onClick={() => setShowApi(s => !s)}>{showApi ? '숨기기' : '표시'}</button>
          </div>
        </div>
        <div style={{marginTop:12, display:'flex', gap:8}}>
          <button className="ui-button ui-btn-primary" onClick={save}>저장</button>
          <button className="ui-button ui-btn-secondary" onClick={exportJson}>내보내기</button>
          <button className="ui-button ui-btn-ghost" onClick={reset}>초기화</button>
        </div>
      </div>
    </div>
  )
}
