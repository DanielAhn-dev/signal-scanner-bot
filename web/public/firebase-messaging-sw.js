// Firebase Cloud Messaging — 백그라운드(탭 닫힘/비활성) 푸시 수신 전용 서비스워커.
// PWA 앱 셸 캐싱은 /sw.js가 별도로 담당(scope 분리는 firebaseMessaging.ts 참고).
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// 공개 식별자(비밀값 아님) — Firebase 웹 SDK 구성은 원래 클라이언트에 노출되는 값이다.
firebase.initializeApp({
  apiKey: 'AIzaSyAZoew0MBMjnZ86TmHNqSAGirP1xzxXaBo',
  authDomain: 'signal-scanner-bot.firebaseapp.com',
  projectId: 'signal-scanner-bot',
  storageBucket: 'signal-scanner-bot.firebasestorage.app',
  messagingSenderId: '1044797545546',
  appId: '1:1044797545546:web:717a188bb4ed8e552c5ab3',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // 서버는 data-only 메시지로 보낸다(payload.notification과 함께 오면 SW 자동표시 + 아래
  // showNotification이 겹쳐 알림이 2개 뜬다).
  const d = payload.data || {};
  const title = d.title;
  const body = d.body;
  if (!title) return;
  const id = d.id;
  self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    data: payload.data || {},
    ...(id ? { tag: `nexora-${id}` } : {}),
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const rawUrl = data.url || data.path || '/';
  event.waitUntil((async () => {
    const targetUrl = new URL(rawUrl, self.location.origin).href;
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      if (client.url === targetUrl && 'focus' in client) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});
