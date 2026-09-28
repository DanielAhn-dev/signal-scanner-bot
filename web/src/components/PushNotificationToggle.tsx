import React from 'react'
import { useToast } from './ToastProvider'
import { requestFcmToken } from '../lib/firebaseMessaging'
import {
  registerPushToken,
  unregisterPushToken,
  sendTestPush,
  pushEnabledStorageKey,
  pushOptOutStorageKey,
} from '../features/profile/pushTokens'

type Props = { isSignedIn: boolean }

/** 브라우저 PWA 푸시(FCM) 토글 — 텔레그램과 별개 채널. 기본값 ON: 명시적으로 끈 적(opt-out
 *  플래그) 없으면 로그인/방문마다 다시 켜기를 시도한다. planet/apps/intranet의
 *  UserPushToggle.tsx 상태 머신을 이 프로젝트 UI 스타일로 이식.
 *  프로필 페이지(features/profile)와 헤더의 ProfileModal 양쪽에서 공유한다. */
export function PushNotificationToggle({ isSignedIn }: Props) {
  const toast = useToast()
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'on' | 'off' | 'error'>('idle')
  const [testing, setTesting] = React.useState(false)
  const tokenRef = React.useRef<string | null>(null)

  const enable = React.useCallback(async (silent = false) => {
    if (!silent) setStatus('loading')
    try {
      const token = await requestFcmToken()
      if (!token) {
        // 사용자가 권한을 거부/보류한 정상적인 경우 — 자동 시도(silent)에서는 조용히 idle로 복귀하고,
        // 직접 클릭했을 때만 안내한다.
        setStatus(silent ? 'idle' : 'off')
        localStorage.removeItem(pushEnabledStorageKey())
        if (!silent) toast.show('알림 권한이 허용되지 않았습니다')
        return
      }
      const ok = await registerPushToken(token)
      if (!ok) {
        setStatus('error')
        localStorage.removeItem(pushEnabledStorageKey())
        if (!silent) toast.show('토큰 등록에 실패했습니다 — 로그인 상태를 확인해주세요')
        return
      }
      tokenRef.current = token
      localStorage.setItem(pushEnabledStorageKey(), '1')
      localStorage.removeItem(pushOptOutStorageKey())
      setStatus('on')
    } catch (e) {
      console.error('[PushNotificationToggle] enable failed', e)
      setStatus('error')
      localStorage.removeItem(pushEnabledStorageKey())
      if (!silent) toast.show(`알림 설정 실패: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [toast])

  const disable = React.useCallback(async () => {
    setStatus('loading')
    try {
      if (tokenRef.current) await unregisterPushToken(tokenRef.current)
    } catch (e) {
      console.error('[PushNotificationToggle] disable failed', e)
    } finally {
      localStorage.removeItem(pushEnabledStorageKey())
      localStorage.setItem(pushOptOutStorageKey(), '1')
      setStatus('off')
    }
  }, [])

  React.useEffect(() => {
    if (typeof Notification === 'undefined') return
    if (!isSignedIn) return
    if (localStorage.getItem(pushOptOutStorageKey()) === '1') {
      setStatus('off')
      return
    }
    const enabledBefore = localStorage.getItem(pushEnabledStorageKey()) === '1'
    if (Notification.permission === 'granted' && enabledBefore) {
      setStatus('on')
      void enable(true)
      return
    }
    if (Notification.permission !== 'denied') {
      void enable()
    }
  }, [enable, isSignedIn])

  if (typeof Notification === 'undefined') return null

  const handleTest = async () => {
    setTesting(true)
    const result = await sendTestPush()
    setTesting(false)
    if (result.ok && result.sent > 0) toast.show('테스트 알림을 보냈습니다')
    else if (result.ok) toast.show('등록된 기기가 없습니다')
    else toast.show(`발송 실패: ${result.error || '알 수 없는 오류'}`)
  }

  const label = !isSignedIn
    ? '브라우저 푸시 알림 (Google 로그인 필요)'
    : Notification.permission === 'denied'
      ? '브라우저 푸시 알림 (브라우저 설정에서 차단됨)'
      : status === 'loading'
        ? '브라우저 푸시 알림 (설정 중…)'
        : status === 'error'
          ? '브라우저 푸시 알림 (설정 실패 — 클릭해서 재시도)'
          : '브라우저 푸시 알림'

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        type="checkbox"
        checked={status === 'on'}
        disabled={!isSignedIn || status === 'loading' || Notification.permission === 'denied'}
        onChange={(e) => void (e.target.checked ? enable() : disable())}
      />
      <span className={status === 'error' ? undefined : 'muted'} style={status === 'error' ? { color: '#dc2626' } : undefined}>
        {label}
      </span>
      {status === 'on' && (
        <button
          type="button"
          className="ui-button ui-btn-ghost"
          onClick={handleTest}
          disabled={testing}
          style={{ marginLeft: 4 }}
        >
          {testing ? '발송 중…' : '테스트 발송'}
        </button>
      )}
    </label>
  )
}
