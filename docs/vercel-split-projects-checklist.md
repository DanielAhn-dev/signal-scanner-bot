# Vercel 분리 프로젝트 체크리스트 (텔레그램/백엔드 + 웹)

목표: 텔레그램/공통 API 백엔드와 웹 프론트를 Vercel에서 서로 다른 프로젝트로 운영하되, API는 하나의 백엔드를 공통 사용한다.

## 1) 프로젝트 역할 분리

- backend 프로젝트: 텔레그램 웹훅, cron, 공통 API 제공
- web 프로젝트: 정적 프론트엔드 UI 제공

권장 도메인 예시

- backend: `https://signal-scanner-bot.vercel.app`
- web: `https://signal-scanner-web.vercel.app`

## 2) Vercel 프로젝트 설정

### backend 프로젝트

- Root Directory: 저장소 루트
- `vercel.json` 사용: 루트의 `vercel.json`
- 서버 함수: `api/index.ts`, `api/telegram.ts`, `api/cron.ts`, `api/ui.ts`, `api/update.ts`, `api/worker.ts`

필수 환경변수(예시)

- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `UI_READ_KEY`
- `CRON_SECRET`

### web 프로젝트

- Root Directory: `web`
- Build Command: `pnpm build`
- Output Directory: `dist`

필수 환경변수(예시)

- `VITE_API_BASE=https://signal-scanner-bot.vercel.app`
- `VITE_UI_READ_KEY=<backend의 UI_READ_KEY와 동일 값>`

## 3) 배포 후 스모크 테스트

### backend 확인

- `GET /api` -> `200 ok`
- `GET /api/ui?route=summary` -> `200` 또는 인증 실패(`401/403`)

`404 NOT_FOUND`가 나오면 아래를 우선 확인

- backend 프로젝트 Root Directory가 루트인지
- backend 프로젝트가 최신 커밋으로 배포되었는지
- `vercel.json`이 backend 프로젝트에서 적용되었는지

### web 확인

- 웹 진입 후 대시보드 로드 시 `/api/ui/summary` 오류가 없어야 함
- 브라우저 캐시/로컬 저장값 영향 시 아래 실행
  - `localStorage.removeItem('signal_scanner_api_base')`

## 4) 자주 발생하는 실수

- web 프로젝트의 `VITE_API_BASE`를 web 도메인으로 설정함
- backend의 `UI_READ_KEY`와 web의 `VITE_UI_READ_KEY` 값이 다름
- backend 프로젝트가 다른 브랜치/이전 커밋을 배포 중

## 5) 운영 원칙

- 텔레그램 기능과 공통 데이터 API는 backend 하나에서 관리
- 웹은 UI만 배포하고 API는 항상 backend를 바라봄
- API 스키마 변경 시 backend 먼저 배포 후 web 배포
