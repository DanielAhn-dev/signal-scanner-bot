import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { clearStashedCouple, clearStashedInvite, readStashedCouple, readStashedInvite } from '../../lib/inviteStash'

type Props = {
  email: string
  request: 'pending' | 'approved' | 'rejected' | null
  signupsOpen: boolean
  onJoined: () => void
  onSignOut: () => void
}

/** 초대 전용 모드에서 아직 회원이 아닌 로그인 계정에게 보이는 화면 */
export default function InviteGate({ email, request, signupsOpen, onJoined, onSignOut }: Props) {
  const [code, setCode] = useState(() => readStashedCouple() || readStashedInvite())
  const fromCouple = !!readStashedCouple()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [requestState, setRequestState] = useState(request)
  const [note, setNote] = useState('')

  const post = (body: Record<string, unknown>) =>
    apiFetch('/api/ui/invites', { method: 'POST', body: JSON.stringify(body), cacheMs: 0, retries: 0, timeoutMs: 15_000 })

  const redeem = async () => {
    if (!code.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await post({ action: 'redeem', code })
      if (res?.ok) {
        clearStashedInvite()
        clearStashedCouple()
        onJoined()
        return
      }
      setError(res?.error || '가입하지 못했습니다.')
    } catch (e: any) {
      setError(e?.message || '가입 중 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { setRequestState(request) }, [request])

  const sendRequest = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await post({ action: 'request', email, note })
      setRequestState(res?.status ?? 'pending')
    } catch (e: any) {
      setError(e?.message || '신청하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-status-main">
      <div className="auth-status-card">
        <h1 className="auth-status-title">초대받은 분만 이용할 수 있어요</h1>
        <p className="auth-status-desc" style={{ marginBottom: 'var(--space-4)' }}>
          {email ? `${email} 계정으로 로그인했습니다.` : '로그인했습니다.'}<br />
          {fromCouple ? '배우자가 보낸 연결 코드로 가입하면 바로 서로 연결됩니다.' : '친구에게 받은 초대 코드나 배우자의 연결 코드를 입력하면 바로 시작할 수 있습니다.'}
        </p>

        {!signupsOpen && (
          <p className="auth-status-desc" style={{ color: 'var(--color-warning)', marginBottom: 'var(--space-3)' }}>
            지금은 신규 가입을 잠시 멈춘 상태입니다.
          </p>
        )}

        <input
          className="ui-input ui-text"
          style={{ width: '100%', textAlign: 'center', letterSpacing: '0.12em', fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-3)' }}
          placeholder="XXXXX-XXXXX"
          value={code}
          maxLength={16}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') void redeem() }}
        />
        <button className="ui-button ui-btn-primary" style={{ width: '100%' }} disabled={busy || !code.trim() || !signupsOpen} onClick={() => void redeem()}>
          {busy ? '확인 중...' : '초대 코드로 시작하기'}
        </button>
        {!!error && (
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-error)', marginTop: 'var(--space-3)' }}>{error}</p>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--color-excel-grid-border)', margin: 'var(--space-5) 0' }} />

        {requestState === 'pending' && (
          <p className="auth-status-desc">가입 신청을 받았습니다. 승인되면 다시 접속할 때 바로 들어올 수 있어요.</p>
        )}
        {requestState === 'approved' && (
          <button className="ui-button ui-btn-primary" style={{ width: '100%' }} onClick={onJoined}>승인됐어요 — 시작하기</button>
        )}
        {requestState === 'rejected' && (
          <p className="auth-status-desc">이번 가입 신청은 받지 못했습니다.</p>
        )}
        {!requestState && (
          <>
            <p className="auth-status-desc" style={{ marginBottom: 'var(--space-2)' }}>초대 코드가 없다면 가입을 신청할 수 있어요.</p>
            <input
              className="ui-input ui-text"
              style={{ width: '100%', marginBottom: 'var(--space-2)' }}
              placeholder="한 줄 소개 (선택)"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="ui-button ui-btn-secondary" style={{ width: '100%' }} disabled={busy} onClick={() => void sendRequest()}>
              가입 신청하기
            </button>
          </>
        )}

        <button className="ui-button" style={{ width: '100%', marginTop: 'var(--space-4)' }} onClick={onSignOut}>다른 계정으로 로그인</button>
      </div>
    </div>
  )
}
