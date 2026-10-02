import { apiFetch } from '../../lib/api'
import { userScopedKey } from '../../lib/userState'
import { requestFcmToken } from '../../lib/firebaseMessaging'

// 계정마다 따로 — 같은 브라우저에서 다른 계정이 켠 상태가 보이면 안 된다 (로그인 전에는 공용 키)
export const pushEnabledStorageKey = () => userScopedKey('fcm_push_enabled') ?? 'fcm_push_enabled'
/** 사용자가 종 아이콘에서 명시적으로 끈 경우에만 세팅 — 이 플래그가 있으면 로그인 시 자동 재요청/재구독을 하지 않는다 */
export const pushOptOutStorageKey = () => userScopedKey('fcm_push_optout') ?? 'fcm_push_optout'

/** 이 브라우저(기기)의 안정적인 식별자 — device_id로 실어, FCM 토큰이 로테이션돼도 한 기기당
 *  토큰 행 하나로 수렴시킨다. localStorage를 못 쓰는 환경(사파리 프라이빗 등)이면 null. */
function getDeviceId(): string | null {
  try {
    const KEY = 'nexora_device_id'
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return null
  }
}

/** 이 레포는 웹 UI가 Supabase에 직접 쓰지 않고 API 핸들러(service_role)를 통해서만 접근하는
 *  컨벤션이라(RLS가 anon 직접 접근을 막아둠), 토큰 등록도 서버 라우트를 거친다. */
export async function registerPushToken(token: string): Promise<boolean> {
  try {
    const json = await apiFetch('/api/ui/push-token', {
      method: 'POST',
      body: JSON.stringify({ token, device_id: getDeviceId() }),
      cacheMs: 0,
      timeoutMs: 10_000,
      retries: 0,
    })
    return Boolean(json?.ok)
  } catch (e) {
    console.error('[pushTokens] registerPushToken error:', e)
    return false
  }
}

export async function unregisterPushToken(token: string): Promise<boolean> {
  try {
    const json = await apiFetch('/api/ui/push-token', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
      cacheMs: 0,
      timeoutMs: 10_000,
      retries: 0,
    })
    return Boolean(json?.ok)
  } catch (e) {
    console.error('[pushTokens] unregisterPushToken error:', e)
    return false
  }
}

export type SendTestPushResult = { ok: boolean; sent: number; failed: number; error?: string }

/** 본인 기기로 테스트 푸시 발송 — 서버 API(Firebase Admin SDK)로 위임. */
export async function sendTestPush(): Promise<SendTestPushResult> {
  try {
    const json = await apiFetch('/api/ui/push-send', {
      method: 'POST',
      body: JSON.stringify({ title: '테스트 알림', body: '푸시 알림이 정상적으로 도착했습니다.' }),
      cacheMs: 0,
      timeoutMs: 15_000,
      retries: 0,
    })
    return { ok: true, sent: json?.sent ?? 0, failed: json?.failed ?? 0 }
  } catch (e) {
    console.error('[pushTokens] sendTestPush error:', e)
    return { ok: false, sent: 0, failed: 0, error: String(e) }
  }
}

/** 이전에 알림을 켠 사용자는 앱을 열 때마다 FCM 서비스워커/토큰을 조용히 재구독한다.
 *  서비스워커 등록이 알림 패널을 열 때만 일어나면, 브라우저가 그 사이에 워커를 정리해버려
 *  서버는 발송 성공으로 보이는데 기기엔 푸시가 도착하지 않는 문제가 생긴다. */
export async function ensurePushSubscription(): Promise<void> {
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  if (localStorage.getItem(pushEnabledStorageKey()) !== '1') return

  const token = await requestFcmToken()
  if (!token) return
  await registerPushToken(token)
}
