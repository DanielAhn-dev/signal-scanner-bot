import type { MessagePayload, Messaging } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
}

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string

// firebase SDK(app + messaging + installations)는 gzip 기준 40KB가 넘는데, 실제로 필요한 건
// "알림 권한을 이미 허용하고 푸시를 켠 사용자가 앱을 열 때" 뿐이다. 정적 import로 두면 SDK가
// 통째로 엔트리 청크에 들어가 푸시를 안 쓰는 사용자까지 첫 화면에서 그 비용을 낸다. 그래서 실제
// 호출 시점에 동적으로 불러오고, 한 번 받은 모듈은 프라미스째 재사용한다.
let firebaseModulesPromise: Promise<{
  appModule: typeof import('firebase/app')
  messagingModule: typeof import('firebase/messaging')
}> | null = null

function loadFirebaseModules() {
  if (!firebaseModulesPromise) {
    firebaseModulesPromise = Promise.all([
      import('firebase/app'),
      import('firebase/messaging'),
    ]).then(([appModule, messagingModule]) => ({ appModule, messagingModule }))
  }
  return firebaseModulesPromise
}

function getFirebaseApp(appModule: typeof import('firebase/app')) {
  const { getApps, getApp, initializeApp } = appModule
  return getApps().length ? getApp() : initializeApp(firebaseConfig)
}

/** PushManager.subscribe는 active 상태의 서비스워커가 필요한데, register() 직후에는
 *  installing/waiting 상태일 수 있어 활성화될 때까지 기다린다. */
function waitUntilActive(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve()
  const worker = registration.installing || registration.waiting
  if (!worker) return Promise.resolve()
  return new Promise((resolve) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve()
    })
  })
}

/** 탭이 foreground일 때는 FCM이 onBackgroundMessage를 건너뛰고 onMessage로만 전달하므로,
 *  백그라운드와 동일하게 registration.showNotification으로 띄워야 탭을 열어둔 채로도 알림이 보인다. */
function showForegroundNotification(registration: ServiceWorkerRegistration, payload: MessagePayload) {
  const title = payload.data?.title
  const body = payload.data?.body
  if (!title) return
  const id = payload.data?.id
  void registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    data: payload.data || {},
    ...(id ? { tag: `nexora-${id}` } : {}),
  })
}

let foregroundListenerAttached = false

function attachForegroundListenerOnce(
  messaging: Messaging,
  registration: ServiceWorkerRegistration,
  onMessage: typeof import('firebase/messaging').onMessage,
) {
  if (foregroundListenerAttached) return
  foregroundListenerAttached = true
  onMessage(messaging, (payload) => showForegroundNotification(registration, payload))
}

// /sw.js(PWA 캐싱)도 기본 scope('/')를 쓰므로, 같은 scope를 공유하면 페이지 새로고침마다
// /sw.js 재등록이 이 워커를 덮어써서 백그라운드 푸시가 끊긴다. 별도 scope로 분리해 충돌 방지.
const PUSH_SCOPE = '/firebase-cloud-messaging-push-scope'
const SW_PATH = '/firebase-messaging-sw.js'

/** 알림 권한 요청 + FCM 토큰 발급. 미지원 환경(인앱 브라우저 등)이면 null 반환 */
export async function requestFcmToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return null
  if (!firebaseConfig.apiKey || !VAPID_KEY) return null

  const { appModule, messagingModule } = await loadFirebaseModules()
  const { getMessaging, getToken, isSupported, onMessage } = messagingModule

  if (!(await isSupported().catch(() => false))) return null

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const registration = await navigator.serviceWorker.register(SW_PATH, { scope: PUSH_SCOPE })
  await waitUntilActive(registration)
  const messaging = getMessaging(getFirebaseApp(appModule))
  attachForegroundListenerOnce(messaging, registration, onMessage)
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  })
  return token || null
}
