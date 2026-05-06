# Continuation Handoff (2026-05-06)

- 프로젝트: signal-scanner-bot
- 목적: 어떤 환경/작업자에서도 즉시 이어서 작업할 수 있도록 현재 상태를 고정
- 기준: 현재 워킹트리 + 최신 빌드 성공(pnpm build)

## 1) 이번 사이클에서 반영된 핵심 변경

### 웹 접근/프로필 UX
- 로그인 시 프로필 모달 자동 오픈 제거
- Chat ID를 필수값이 아닌 선택 연동값으로 전환
- 미연동 사용자용 중앙 안내 블럭(CTA) 추가
  - 버튼 클릭 시 프로필 모달 즉시 오픈
- 프로필 모달에 가이드(details/아코디언) 추가

### 프로필 저장 안정화
- 서버 프로필 동기화 시 null/빈값이 로컬 Chat ID를 덮어쓰던 케이스 수정
- 모달 오픈 시 Chat ID가 있으면 텔레그램 프로필 자동 조회(1회)
- 수동 조회 API를 웹 공용 API로 통일

### 콘텐츠/정보 구조
- 웹 News 메뉴/페이지 추가
- 텔레그램 뉴스 소스와 웹 소스 연결
- 종목 상세 모달 공통 컴포넌트화
  - feed/watchlist/news에서 재사용

### API/CORS/인증 정리
- 일부 핸들러(stocks, stock-latest) CORS/인증 규칙을 trusted origin + UI key 정책으로 정리
- chat_id 미연동 시 summary/positions/decisions/settings(GET)에서 빈 응답/완화 응답 제공

## 2) 현재 워킹트리 변경 파일(미커밋)

- 수정(M):
  - api/ui.ts
  - handlers/ui/decisions.ts
  - handlers/ui/positions.ts
  - handlers/ui/settings.ts
  - handlers/ui/stock-latest.ts
  - handlers/ui/stocks.ts
  - handlers/ui/summary.ts
  - web/src/App.tsx
  - web/src/components/Header.tsx
  - web/src/components/ProfileModal.tsx
  - web/src/features/dashboard/index.tsx
  - web/src/features/feed/index.tsx
  - web/src/features/settings/index.tsx
  - web/src/features/watchlist/index.tsx
  - web/src/lib/userContext.ts
  - web/src/navigation.ts

- 신규(??):
  - handlers/ui/news.ts
  - handlers/ui/telegram-profile.ts
  - web/src/components/StockDetailModal.tsx
  - web/src/components/TelegramLinkCallout.tsx
  - web/src/features/news/index.tsx
  - web/src/lib/profileModal.ts

## 3) 문서 상태

- 기존 참조 문서
  - docs/implementation-master-plan.md
  - docs/current-deployment-status.md
  - docs/telegram-command-mapping.md
  - docs/continuation-handoff-2026-04-17.md

- 이번에 추가된 문서
  - docs/telegram-web-gap-analysis-2026-05-06.md
  - docs/continuation-handoff-2026-05-06.md (본 문서)

## 4) 즉시 재개 체크리스트

1. 변경분 커밋 전 최종 확인
- pnpm build
- 주요 화면 수동 점검: dashboard, settings, profile modal, news, feed, watchlist

2. 배포 환경 변수 점검
- UI_TRUSTED_WEB_ORIGINS
- UI_READ_KEY / VITE_UI_READ_KEY (일치)
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- TELEGRAM_BOT_TOKEN (telegram-profile fallback 사용 시)

3. 회귀 포인트
- 로그인 후 Chat ID 유지 여부
- 프로필 모달 자동 조회 성공률
- chat_id 미연동 사용자의 빈 화면 처리(400 없이 정상 렌더)
- 뉴스/종목상세 모달 호출

## 5) 다음 작업 권장 순서

1. Position Maintenance MVP
- watchreset, holdingedit, liquidateall 웹 UI 구현

2. Operations MVP
- autocycle/autotrigger/autosellcheck 운영 패널 + 실행 이력

3. Plan Center MVP
- watchplan/holdingplan/premarket 전용 화면

4. ETF Hub MVP
- etf 추천/정보/분배금 탭

## 6) 실행 명령(로컬)

- 의존성/타입검사
  - pnpm install
  - pnpm build

- 로컬 서버
  - pnpm local

- 필요 시 테스트
  - pnpm test

## 7) 참고 메모

- 현재 상태는 "기능 정리 + UX 완화 + 연동 안정화" 단계이며, 다음 단계는 "운영기능(자동화/보수작업) 웹 전환"이다.
- 운영 안정성 관점에서, 기능 추가보다 먼저 실행 이력/실패 원인 가시화(Operations MVP)를 추천한다.
