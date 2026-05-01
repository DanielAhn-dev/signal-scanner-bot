**웹 하이브리드 통합 요약**
- **목표**: 기존 텔레그램 중심의 SIGNAL-SCANNER-BOT을 모바일 우선의 웹 UI(React+TypeScript+Tailwind v4)와 하이브리드로 통합. 웹에서 기존 기능을 조회·설정하고, 웹에서 설정한 알림을 텔레그램으로 전달.
- **상태**: 프런트엔드 초기 스캐폴드와 핵심 페이지, 서버 프록시 엔드포인트, 알림 테스트 경로 구현 완료. 로컬 개발 흐름 문서화됨.

**변경된/추가된 주요 파일**
- **프런트엔드 (web/)**: `web/package.json`, `web/vite.config.ts`, `web/index.html`, `web/src/*` (App, pages: `Dashboard.tsx`, `Portfolio.tsx`, `Trades.tsx`, `Settings.tsx`, `components/Header.tsx`, `lib/api.ts`, `lib/supabase.ts`, `styles/index.css`), `web/.env.example`, `web/README.md`
- **스타일/빌드**: `web/postcss.config.cjs`, `web/tailwind.config.cjs` (Tailwind v4 설정, `@tailwindcss/postcss` 사용)
- **백엔드(서버리스 함수)**: `api/ui/positions.ts`, `api/ui/decisions.ts`, `api/ui/summary.ts`, `api/ui/notify.ts`
- **기타**: 기존 코드베이스의 텔레그램 유틸(`src/telegram/api.ts`) 재사용

**로컬 개발 및 실행 (권장 순서)**
1. 루트 프로젝트에 서버 환경변수 설정(예시 `.env` 또는 PowerShell 환경 변수):

```powershell
# 루트(프로젝트)에서 실행
$env:UI_READ_KEY = 'your-ui-key'
$env:DEFAULT_TELEGRAM_CHAT_ID = '123456789'
$env:TELEGRAM_BOT_TOKEN = 'bot_token_here'
$env:SUPABASE_URL = 'https://your-project.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
```

2. `web/.env` 작성(프런트 개발용):

```text
VITE_API_BASE=http://localhost:3000
VITE_UI_READ_KEY=your-ui-key
```

3. 루트에서 로컬 백엔드(서버리스 함수) 실행:

```powershell
cd D:\Dev\Github\signal-scanner-bot
pnpm local
# 또는: pnpm dlx vercel dev
```

4. 별도 터미널에서 프런트 실행:

```powershell
cd D:\Dev\Github\signal-scanner-bot\web
pnpm install
pnpm dev
```

5. 브라우저에서 `http://localhost:5173` 접속 후 대시보드/포트폴리오/거래기록 확인.

**직접 엔드포인트 검사 (백엔드가 실행된 상태에서)**
- 포지션: `curl -H "x-ui-key: your-ui-key" http://localhost:3000/api/ui/positions`
- 결정 로그: `curl -H "x-ui-key: your-ui-key" http://localhost:3000/api/ui/decisions`
- 요약: `curl -H "x-ui-key: your-ui-key" http://localhost:3000/api/ui/summary`

**기술적 요점 / 구현 상세**
- 프런트는 Vite + React + TypeScript + Tailwind v4로 구성됨.
- `web/src/lib/api.ts`: 공통 API 헬퍼(`apiFetch`) 추가 — `VITE_API_BASE` 사용, `x-ui-key` 자동 추가, non-JSON 응답/네트워크 오류를 명확히 처리.
- Vite 개발 서버 프록시: `web/vite.config.ts`에서 `/api`를 `http://localhost:3000`으로 포워딩하도록 설정(로컬 vercel dev와 연동).
- 서버리스 엔드포인트(`api/ui/*`)는 `UI_READ_KEY`로 보호되며 Supabase 서비스 역할 키로 데이터를 조회하도록 설계됨.
- 알림 전송: `api/ui/notify`가 `src/telegram/api.ts`의 `sendMessage`를 호출하여 Telegram으로 메시지를 전달.

**리포트 웹보기 / 공유 고도화**
- `api/ui/report-web.ts`: PDF 대신 HTML 리포트 웹뷰를 생성해 우측 드로어에서 바로 열람할 수 있게 함.
- `api/ui/report-share.ts`: 공유 링크 발급, 최근 공유 조회, 공유 철회까지 처리하는 저장형 엔드포인트로 확장.
- `api/ui/report-shared.ts`: 공유 링크 접속 시 초대코드 확인 페이지를 먼저 보여주고, 통과하면 저장된 리포트 본문을 HTML로 렌더링.
- `src/services/reportShareService.ts`: 공유 링크의 발급 이력, 만료 시각, 접근 횟수, 철회 상태를 Supabase `ui_report_shares` 테이블에 저장.
- `src/services/reportWebRenderService.ts`: 웹 리포트/공유 리포트가 동일한 레이아웃, 문단 파싱, Open Graph/Twitter 메타 태그를 사용하도록 공통 렌더러 제공.
- `web/src/features/reports/index.tsx`: 다운로드 / 웹보기 / 공유 버튼을 같은 그룹으로 묶고, 공유 모달에서 최근 공유 링크 조회 및 철회까지 가능하도록 연결.
- `web/src/components/ShareModal.tsx`: URL 복사, 초대코드 복사, 만료 시각 확인, 최근 공유 링크 관리 UI 제공.

**공유 링크 운영 메모**
- 공유 링크는 기본 24시간 후 만료되며, 발급 즉시 초대코드 6자리가 함께 생성됩니다.
- 링크만으로는 열람할 수 없고, 초대코드를 함께 전달해야 리포트가 열립니다.
- 운영자는 웹의 공유 모달에서 최근 링크를 다시 복사하거나 즉시 철회할 수 있습니다.
- 공유 페이지는 저장된 본문을 보여주므로, 발급 시점의 리포트 상태가 유지됩니다.

**보안 / 주의사항**
- 민감한 키(`TELEGRAM_BOT_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`)는 절대 클라이언트에 노출하면 안 됩니다. 서버 환경변수로 관리하세요.
- `VITE_SUPABASE_ANON_KEY` 대신 서버 프록시(`api/ui/*`)를 통해 데이터 조회하도록 구성했습니다(클라이언트에 공개 키 저장하지 않음).

**남은 작업 / 권장 다음 단계**
- Google OAuth / 사용자 인증 (Supabase Auth) 통합 — 사용자별 설정·알림을 관리하려면 필요.
- `Settings`에서 알림 키워드/필터를 Supabase에 저장하고 서버에서 이벤트에 따라 알림 발송 연결.
- 가상매매(autotrade) UI: 주문 상세·매수 이유·포지션 열람 및 수동 트리거(드라이런) 엔드포인트 구현.
- 시각화: 거래/포트폴리오 이력 차트 추가(예: Chart.js, Recharts).
- 배포: Vercel로 `web`을 정식 배포(모노레포 내 동일 프로젝트에 추가하거나 별도 앱으로 분리).

추가 문서 보강(현재 미구현 항목 및 메뉴 매핑)
- 텔레그램 메뉴 → 웹 라우트 매핑(현황):
	- /dashboard: `Dashboard` 페이지 (요약, 스캔 시각화)
	- /portfolio: `Portfolio` 페이지 (가상 포지션 및 관심목록 분리)
	- /trades: `Trades` 페이지 (결정 로그 / 거래 기록)
	- /settings: `Settings` 페이지 (가상 자동매매 설정, 알림 테스트)

- 미구현/부분 구현된 텔레그램 메뉴 기능:
	- 실시간 주문 전송/취소 (가상/실제 주문 드라이런과 실행 연동 아직 필요)
	- 상세 주문 히스토리(로트별 FIFO 매칭의 풀 조회 및 UI 필터)
	- 사용자별 권한/로그인 흐름 (현재는 서버 환경변수 기반 chat_id 사용)
	- 일부 알림 필터(키워드 기반) 및 알림 규칙 편집 UI

- UI 개선 권장(우선순위):
	1. 상단 GNB/NAV를 완전한 모바일 퍼스트로 다듬기(햄버거 토글, 전체 폭 드롭다운, 터치 영역 확대) — 적용 완료(헤더 리팩터링)이지만 스타일 디테일 추가 권장
	2. 페이지별 카드 여백 및 반응형 그리드 일관화 — 대부분 적용 완료
	3. Tailwind 유틸 복구 및 통일된 디자인 토큰 적용(색상/스페이싱)

위 항목을 문서 상단의 '남은 작업'에 병기했습니다. 구현 우선순위 및 상세 스펙을 원하시면 제가 바로 정리해 드리겠습니다.

**참고 및 연락**
- 구현 파일과 경로는 위의 '변경된/추가된 주요 파일' 항목을 확인하세요.
- 로컬 테스트 또는 배포 관련 문제 발생 시 콘솔 로그(프론트/백엔드)와 `.env`(값은 제거) 샘플을 공유해 주세요.

---
문서 작성자: 내부 자동 생성 — 필요하면 문서 형식(간단한 README, 운영 체크리스트)으로 확장하겠습니다.
