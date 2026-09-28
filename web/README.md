# Signal Scanner — Web (MVP)

This folder contains a minimal Vite + React + TypeScript + Tailwind(v4) scaffold for the Signal Scanner web UI.

Quick start:

```bash
cd web
pnpm install # or npm install
pnpm dev
```

Notes:
- Uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Supabase access (MVP read-only).
- This is a frontend-only scaffold; backend APIs remain in the root `api/` serverless functions.

## Auth setup (Supabase Google OAuth)

Web now uses Supabase Auth for Google sign-in.

Required web env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE` (only when web and api are deployed separately)
- `VITE_UI_READ_KEY` (must match backend `UI_READ_KEY` for protected `/api/ui/*` routes)

`VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_REDIRECT_URI`, `VITE_GOOGLE_CALLBACK_URL` are not required in this app flow because OAuth client and redirect settings are managed in Supabase.

Supabase dashboard configuration:

- Enable Google provider in Authentication > Providers.
- Add redirect URLs in Authentication > URL Configuration:
	- Local: `http://localhost:5173`
	- Production web URL (for example): `https://your-web-project.vercel.app`

Vercel settings:

- Set the same web env vars in the web project.
- Ensure backend project also has `UI_READ_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.

Optional (advanced access admin):

- `UI_ADMIN_CHAT_IDS` (comma-separated Telegram chat IDs)
- `UI_ADMIN_CHAT_ID` (single admin ID fallback)

Advanced access feature:

- Advanced routes (`trigger-update`, `trigger-briefing`, `sync-*`, `report-*`) require Telegram chat based allow-list.
- Admin can add/remove/toggle users in web Settings > 고급 기능 사용자 관리.
- Access data is stored in `web_advanced_access_users` (see `db/migrations/005_web_auth_and_access_control.sql`).

## PWA + 브라우저 푸시 알림 (FCM)

텔레그램과 별개로, PWA로 설치한 뒤 브라우저 푸시 알림(Firebase Cloud Messaging)을 받을 수 있다. 프로필 화면의 "브라우저 푸시 알림" 토글로 켜고 끈다.

Required web env vars (Firebase 프로젝트 콘솔 > 프로젝트 설정 > 일반 > 내 앱 > SDK 설정 및 구성 에서 확인):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_VAPID_KEY` (프로젝트 설정 > 클라우드 메시징 > 웹 푸시 인증서)

Required backend env var (root Vercel 프로젝트, `handlers/ui/push-send.ts`가 사용):

- `FIREBASE_SERVICE_ACCOUNT_JSON` — 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성으로 받은 JSON 파일 내용을 한 줄 문자열로 저장 (git에 커밋 금지, Vercel 환경변수로만 관리)

`public/firebase-messaging-sw.js`는 Vite의 env 치환을 받지 않는 정적 파일이라 `firebaseConfig` 값을 직접 하드코딩한다 — 이 값들은 공개돼도 무방한 클라이언트 식별자다(비밀키 아님). Firebase 프로젝트를 바꾸면 이 파일도 같이 갱신해야 한다.
