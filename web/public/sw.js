// Nexora(signal-scanner-bot) 서비스 워커
// 역할: PWA 설치 조건 충족 + 앱 셸 캐싱.
//
// 전략 (planet/apps/intranet의 sw.js 패턴을 이식)
//  - /assets/*  : 파일명에 콘텐츠 해시가 박혀 있어 내용이 바뀌면 이름도 바뀐다 → cache-first(불변)
//  - 아이콘/매니페스트/파비콘: stale-while-revalidate(먼저 보여주고 뒤에서 갱신)
//  - HTML 문서  : network-first. 온라인이면 항상 최신을 받고, 실패할 때만 캐시 → 오프라인 페이지.
//  - 그 외(Supabase 등 외부 도메인, 비-GET)에는 일절 개입하지 않는다.
//
// CACHE_NAME을 올리면 activate에서 이전 캐시를 통째로 지운다(자산 재다운로드 1회).
const CACHE_NAME = 'nexora-v3';
const MAX_ASSET_ENTRIES = 160;

const OFFLINE_HTML = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>네트워크 연결 없음</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f7f7f7;
      color: #333;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      text-align: center;
    }
    .container { padding: 20px; }
    .icon { font-size: 40px; color: #b0b0b0; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 600; color: #4a4a4a; margin: 0 0 10px 0; letter-spacing: -0.5px; }
    p { font-size: 14px; color: #7a7a7a; line-height: 1.6; margin: 0 0 24px 0; word-break: keep-all; }
    button {
      background-color: #ffffff;
      border: 1px solid #d1d1d1;
      color: #4a4a4a;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    button:hover { background-color: #f0f0f0; }
    button:active { background-color: #e4e4e4; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">☁️</div>
    <h1>인터넷 연결이 끊어졌습니다</h1>
    <p>기기가 오프라인 상태이거나 네트워크가 불안정합니다.<br>연결 상태를 확인한 후 다시 시도해 주세요.</p>
    <button onclick="window.location.reload()">다시 시도</button>
  </div>
</body>
</html>
`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).catch(() => {}).then(() => self.clients.claim())
  );
});

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function trimAssetCache(cache) {
  const keys = await cache.keys();
  const assetKeys = keys.filter((req) => new URL(req.url).pathname.startsWith('/assets/'));
  const excess = assetKeys.length - MAX_ASSET_ENTRIES;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(assetKeys[i]);
  }
}

// 캐시는 덤이다. CacheStorage가 고장 나도(open 'Unexpected internal error', put 'Entry already exists',
// 비공개 창·저장 공간 부족 등) 페이지는 네트워크로 열려야 한다. 예전엔 put 실패가 네트워크 실패처럼 처리돼
// 200을 받고도 오프라인 페이지(503)를, open 실패는 응답 자체를 실패(ERR_FAILED)시켜 서비스워커가 설치된 뒤
// 재방문·로그인 복귀(?code=)가 전부 막혔다(2026-10-21).
async function openCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch (err) {
    return null;
  }
}

async function safeMatch(cache, request) {
  if (!cache) return undefined;
  try {
    return await cache.match(request);
  } catch (err) {
    return undefined;
  }
}

async function safePut(cache, request, response) {
  if (!cache) return;
  try {
    await cache.put(request, response);
  } catch (err) {
    // 무시
  }
}

async function cacheFirst(request) {
  const cache = await openCache();
  const cached = await safeMatch(cache, request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cache && response && response.ok) {
    await safePut(cache, request, response.clone());
    await trimAssetCache(cache).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await openCache();
  const cached = await safeMatch(cache, request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) safePut(cache, request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || offlineResponse();
}

async function networkFirstDocument(request) {
  let response = null;
  try {
    response = await fetch(request);
  } catch (err) {
    response = null;
  }
  const cache = await openCache();
  if (response) {
    if (response.ok) await safePut(cache, request, response.clone());
    return response;
  }
  const cached = await safeMatch(cache, request);
  if (cached) return cached;
  const entryCached = await safeMatch(cache, new Request(new URL('/', self.location.origin).href));
  if (entryCached) return entryCached;
  return offlineResponse();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('firebase-messaging-sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstDocument(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith('/icons/') || url.pathname.endsWith('.webmanifest') || url.pathname === '/favicon.ico') {
    event.respondWith(staleWhileRevalidate(request));
  }
});
