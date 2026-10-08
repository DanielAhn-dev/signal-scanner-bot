# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

"Nexora" — 텔레그램 봇 + 웹 UI + 가상(모의) 자동매매로 구성된 한국 주식·ETF 신호/자산관리 시스템. 백엔드는 Vercel Functions(TypeScript, 리전 `icn1`), DB는 Supabase, 웹은 `web/`의 Vite + React. 일부 수집·연구 스크립트는 Python. 사용자 대면 문구와 문서는 한국어다.

## 명령어

환경: Node 20.x, pnpm 10.x (`.nvmrc` 참조). 루트와 `web/`는 각각 별도 `package.json`/lockfile이다.

```bash
pnpm install
pnpm run local            # vercel dev (API + 봇 웹훅 로컬 실행)
pnpm --dir web dev        # 웹 UI (vite, 포트 5173)
pnpm run dev:full         # 둘을 함께 (scripts/dev-full.mjs)

pnpm build                # 루트 타입체크 (tsc --noEmit) — 번들 빌드가 아님
pnpm --dir web typecheck
pnpm run verify:vercel    # 위 둘을 묶은 것. husky pre-commit이 이걸 실행한다

pnpm test                 # tests/*.test.ts 전체 (node:test + tsx)
node --import tsx --test tests/chaseEntry.test.ts   # 테스트 1개만
pnpm --dir web test       # 웹 단위 테스트 (vitest)
```

- `pnpm test`는 `scripts/run-tests.mjs`를 거친다. Windows 셸이 글롭을 펼치지 않아 `tsx --test tests/**/*.test.ts` 직접 호출은 파일을 못 찾는다. 새 테스트는 `tests/` 바로 아래 `*.test.ts`로 둔다(하위 폴더는 수집되지 않음).
- 운영/배치 스크립트는 `package.json`의 `ops:*`, `cron:trigger:*`, `autotrade:*`, `backfill:*`, `etl:*` 항목과 `scripts/`(TS는 `tsx`, 수집·연구는 Python)에 있다. 실서비스 DB를 건드리는 것이 많으므로 `--dryRun=true` 변형이 있으면 먼저 쓴다.
- 운영 가이드 PDF: `pnpm docs:guide:pdf` (원본 `docs/user-operating-guide.md`). CI가 `docs:guide:pdf:check`로 문서-PDF 불일치를 실패 처리한다.

## 아키텍처

### 진입점 (Vercel Functions)
`api/*.ts`는 얇은 라우터이고 실제 로직은 `handlers/`와 `src/`에 있다. 함수 개수·용량 제한 때문에 라우트를 한 함수로 모아 쿼리 파라미터로 분기한다.
- `api/telegram.ts` — 텔레그램 웹훅(15초 제한). 무거운 처리는 `api/worker.ts`(60초)로 넘기고, 명령 문자열 → 카테고리별 타임아웃/실패 알림은 `src/server/workerPolicy.ts`.
- `api/ui.ts` — 웹 UI용 REST. `?route=`로 `handlers/ui/*`를 고르고 `vercel.json` rewrites가 옛 경로를 매핑한다. 고급 라우트는 `handlers/ui/_accessControl.ts`가 접근 제어.
- `api/cron.ts` — `?task=`로 `handlers/cron/*`(briefing, report, scoreSync, strategyGateRefresh, virtualAutoTrade, integrityAudit) 분기. 새 작업은 `TASK_ROUTES`에 등록.
- 모든 진입점은 첫 줄에서 `src/lib/installTruncationGuard`를 import한다.
- 함수별 `maxDuration`은 `vercel.json`에 있다. 새 라우트가 길어지면 여기도 확인.

### 스케줄링: Vercel cron + GitHub Actions
- 장중 점검의 주 경로는 `vercel.json`의 `crons`(평일 UTC 0~5시, 같은 `/api/cron`을 여러 번 호출). Hobby 플랜이라 개당 하루 1회·±59분 오차가 있다.
- 데이터 수집·배치는 `.github/workflows/*.yml`(daily_data, intraday_signals, virtual_autotrade_morning/close, integrity_audit 등). GitHub 스케줄은 4~5시간 늦게 실행될 수 있고, `daily_data.yml`은 평소 23~30분이며 `timeout-minutes: 60`이다. "데이터 신선도 지연" 경고가 뜨면 먼저 이 배치가 취소·실패했는지 보고 `gh workflow run daily_data.yml -f trading_date=YYYYMMDD`로 재실행한다.
- 시각에 민감한 로직을 스케줄 정시에 의존하지 말 것.

### 운영상 비직관적인 사실
- **무료 플랜 최적화가 원칙**이다(유료 업그레이드는 근거가 확인된 뒤에만). 한도: Vercel Hobby 크론, Supabase DB 500MB·Storage 1GB, KRX 차단 위험. 개선안은 이 한도 안에서 설계한다.
- 함수 리전은 `icn1`이어야 한다(기본 iad1이면 서울 인근 Supabase 왕복 때문에 자동사이클이 60초를 넘었다).
- pykrx 전 종목/지수 일괄 API와 KRX MDC 본 엔드포인트는 막혀 있다. 전 종목 스냅샷은 네이버 모바일 API → Storage `market-snapshots`. 네이버 가격은 분배금이 반영된 수정주가라 ETF 총수익 계산에서 분배금을 이중으로 더하지 않도록 주의한다.
- 증권거래세는 `src/lib/securitiesTax.ts`의 `KRX_SELL_TAX_RATE`(코스피·코스닥 0.20%)를 쓴다.
- 휴장 판정: `src/lib/krxLiveSession.ts`(장중 네이버 코스피 거래일 확인)와 휴장일 목록이 **두 곳**(`src/lib/krxCalendar.ts`, `scripts/batch_modules/utils.py`)에 있다. 고칠 때 둘 다 갱신하고, 2027년분은 추정치다.
- 웹 도메인(`stocksweb-seven.vercel.app`)과 API 프로젝트(`signal-scanner-bot.vercel.app`)는 별도 Vercel 프로젝트이고 `web/vercel.json`이 `/api/*`를 API로 rewrite한다. CORS/trusted-origin 코드를 추가할 때 두 도메인을 모두 넣는다.
- 알림 채널: 계정별 `users.prefs.notify_channel`(telegram|push, `src/services/notifyChannel.ts`). 텔레그램 미연결 웹 계정은 `src/services/webAccount.ts`가 예약 번호대 chat_id를 발급하며, `tg()`가 그 ID로 가는 메시지를 FCM 푸시로 돌린다. 명령 답장·버튼·파일은 항상 텔레그램이다.
- GitHub 계정 주의: 저장소 소유는 `DanielAhn-dev`인데 이 PC의 `gh` CLI는 다른 계정으로 로그인돼 있을 수 있다. 새 저장소·시크릿·워크플로를 만들기 전에 어느 계정인지 사용자에게 확인받는다.
- 환경변수 플래그(기본 꺼짐, 사용자가 Vercel에서 켠다): `UI_STRICT_IDENTITY`(Bearer 세션 없는 chat_id/client_id 신원 전부 무시, `handlers/ui/_userContext.ts`), `UI_INVITE_ONLY`(초대 전용 가입, `src/services/invites.ts`). 켜는 시점을 임의로 가정하지 말고 사용자에게 묻는다. Vercel 환경변수 UI는 dotenv와 달리 따옴표를 벗겨주지 않으니 JSON 값에 따옴표를 감싸지 않는다.

### 가상매매 데이터 불변 규칙
- `virtual_trades.pnl_amount`는 수수료·세금·매수수수료를 뺀 **순손익**이다. 손익 관련 새 코드는 이를 전제로 한다.
- 가상매매 대상으로 `virtual_positions`를 읽을 때는 반드시 `.is("broker_name", null).is("account_name", null)`로 실계좌 입력 행을 제외한다(과거 실계좌 입력이 `virtual_cash`를 0으로 눌렀다).
- 웹 전용 계정의 현금도 `users.prefs.virtual_cash`다. 웹 수동 주문은 5초 중복 거절, 최근 종가 ±30% 밖 가격 거절, chat_id 미발급 시 503.
- 실제 계좌에 영향 주는 수동 개입(DB 쓰기·복구 SQL)은 하니스가 막을 수 있으니 SQL을 만들어 사용자가 Supabase SQL Editor에서 직접 실행하게 한다.

### 봇 (`src/bot/`)
`router.ts`(텍스트 명령) / `callbackRouter.ts`(인라인 버튼) → `commands/*` → `services/*`. 명령 이름·접두어·메뉴는 `commandCatalog.ts`와 `menu/`가 단일 출처. 접근 제어는 `accessControl.ts`.

### 도메인 로직
- `src/services/` — 기능별 서비스(스캔, 점수, 포트폴리오, 가상 자동매매, 데이터 품질, 무결성 점검 등). 자동매매는 스윕·지수모드·매수·매도·매도판단으로 분리되어 있다.
- `src/lib/`, `src/indicators/`, `src/score/`, `src/strategies/`, `src/risk/`, `src/execution/` — 순수 계산/지표/전략/리스크. 가능하면 순수 함수로 두고 `tests/`에서 단위 테스트한다.
- `src/adapters/` — 외부 데이터(KRX, 네이버 등) 어댑터. KRX는 일괄 조회가 안 되고 네이버 가격은 분배금 반영 수정주가라는 점에 유의.
- `src/db/client.ts` — Supabase 클라이언트. 가상매매는 RPC 락·중복·가격 검증을 거친다.

### DB 마이그레이션
SQL은 `db/migrations/`(001~032, 번호순)와 `supabase/migrations/`(날짜순) 두 곳에 있다. 자동 적용되지 않으므로 사용자가 Supabase에서 직접 실행한다 — 새 마이그레이션을 추가하면 "실행 필요"를 사용자에게 알릴 것.

### 웹 (`web/`)
Vite + React + TanStack Query + Zustand 계열. `web/src/features/*`가 화면 단위, `web/src/lib/`가 계산(예: `planGuide.ts`), `web/src/data/`에 생성된 연구 수치(`researchFacts.ts` 등)가 있다. 이 데이터 파일은 손으로 고치지 않고 `scripts/research/build_*.py`로 재생성한다. 일반 사용자용 화면은 단순하게, 관리자 전용은 Excel 셸 스타일로 분리하는 방침이다.

### 연구·검증 체계
`scripts/research/`(Python)와 `.research-cache/`(private repo 동기화된 가격·분배금 캐시)로 전략을 검증하고, 결과는 `docs/`에 기록한다. 새 규칙·아이디어를 넣기 전에 먼저 다음을 확인한다:
- `docs/research-index-2026-10-03.md` — 문서·스크립트·남은 일 총정리
- `docs/hypothesis-ledger.md` — 진행 중 가설, 사전 판정 기준, 기록 무결성 이력
- `docs/investment-idea-registry-2026-10-07.md` — 이미 판정(기각/채택)한 아이디어 색인

핵심 방향: 종목선별 알파가 아니라 정기 지수매수 자동화 + 행동 실수 차단 + 리스크 관리가 제품의 가치다("설정하고 냅두기"). 사용자는 보장 수익을 약속하는 표현을 원치 않으며, 주장 범위를 검증된 것으로 제한한다. 레버리지 전략은 제안하지 않는다(사용자 방침). 새 규칙은 결과를 보기 전에 판정 기준을 사전 등록하고, 단타·소형주·청산 규칙 등은 이미 기각됐으니 등록부를 먼저 본다. 화면에 나오는 연구 수치는 기준 기간·표본·한계·생성일을 함께 표시하고(180일 지나면 낡음 표시), 숫자는 스크립트로 생성한다. 전향검증 기준일은 9/28이며 11/23 전에는 새 매매 규칙을 확정하지 않는다.

## 작업 규칙

다른 프로젝트에서 실제 사고로 확인된 교훈 원문은 [docs/engineering-lessons.md](docs/engineering-lessons.md)에 있다(스택이 다르면 원칙만 적용). 아래는 이 저장소에 해당하는 핵심만 추린 것이다. DB·RLS, 번들 성능, CSS/반응형, UI 디자인 작업 전에는 원문의 해당 절을 읽는다.

- 답변과 진행 메모는 한국어로 쓴다.
- 검증으로 확인된 로직 결함은 매매 규칙이라도 즉시 고친다(테스트 포함). 단, 파라미터 튜닝과는 구분한다.
- 새 환경변수는 `.env.local.example`에 반영한다. `.env*` 실값은 커밋 금지.
- 구조·흐름을 바꾸는 UI 변경은 코드 전에 스케치로 승인받는다(라벨 교체 같은 1:1 수정은 바로).
- "코드는 맞는데 화면에 안 보인다" → 캐시보다 먼저 최근 Vercel 배포 로그의 빌드 실패 여부를 본다.
- 성능·크기·느린 쿼리는 추측하지 말고 실측한 뒤 대상을 고른다.
- 엄격한 조건 때문에 결과가 비어 보여도 바로 완화하지 않는다. 버그인지, 그 단계가 아직 운영에서 안 쓰이는 것인지 먼저 확인한다.

### Git·배포
- **푸시는 모아서 한다.** 커밋마다 푸시하지 않는다(원격이 꼭 필요할 때만 즉시). 연속 푸시는 진행 중인 Vercel 배포를 취소시키고, 취소된 배포는 자동 재시도되지 않으며 배포 횟수 한도에도 잡힌다.
- 커밋은 성격별로 잘게 나누고 각각 빌드 가능해야 한다. `git add -A` 금지, 파일을 지정한다. 커밋 직후 `git show --stat HEAD`로 의도한 파일만 들어갔는지 확인한다. 다른 세션이 같은 파일을 편집 중이면 Edit 전에 다시 Read한다.
- 서버리스 함수는 raw `.ts` 워크스페이스 패키지를 import할 수 없다(로컬 tsx는 통과, 배포는 `FUNCTION_INVOCATION_FAILED`). `api/`·`handlers/`가 import하는 코드는 `src/` 안에 둔다.
- 로컬 dev가 운영과 같은 DB를 쓰므로 `setInterval`류 예약 작업·알림 발송은 운영 환경 가드(`VERCEL_ENV === 'production'`) 없이 켜지 않는다. 중복 알림이 나간다.
- Windows에서 dev 프로세스가 실행 중일 때 `pnpm install`을 하면 패키지가 깨진다. 프로세스를 끄고 설치한다.

### 타입체크·검증
- 루트 `tsc --noEmit`은 `api/`, `src/`, `scripts/`만 포함한다. `tests/`는 타입체크 대상이 아니므로 테스트 타입 오류는 `pnpm test` 실행으로만 드러난다. "타입체크 통과"를 보고하기 전에 실제로 돌린 명령을 확인하고, 커밋 전에는 `pnpm run verify:vercel`(루트 + 웹)을 돌린다. 내가 안 건드린 파일에서 에러가 나도 무시하지 말고 원인을 찾는다.
- SQL·마이그레이션은 tsc가 잡지 못한다. 함수·컬럼을 참조하는 새 SQL은 그 이름으로 가장 최근 마이그레이션을 찾아 최신 시그니처와 대조한다.
- 같은 이름의 로직이 서버(`src/`)와 웹(`web/src/lib/`)에 있으면 동일하다고 가정하지 않고 `diff`로 확인한다. 손으로 옮긴 사본은 한쪽만 고쳐져 갈라진다.

### Supabase / DB
- **PostgREST 응답은 1000행에서 조용히 잘린다**(`.limit(20000)`도 소용없음). 1000건을 넘을 수 있는 조회는 처음부터 `.range()` 루프로 페이지네이션하고, 결과가 정확히 1000의 배수면 이 캡을 의심한다.
- `.in()`에 큰 배열(수백 개 이상, 특히 한글 키)을 넘기지 않는다. URL이 커져 `fetch failed`가 나거나 커넥션을 붙잡는다. 대상이 작으면 전부 가져와 JS에서 매칭한다. `.or()` 안의 `neq`/`<>`는 인덱스를 타지 못한다.
- **조회 실패를 "없음"으로 취급하지 않는다.** supabase-js는 네트워크 실패에도 throw하지 않고 `{ data: null, error }`를 준다. "없으면 생성"·화면 분기 전에 일시 오류(0/408/5xx)를 걸러 재시도 상태로 보낸다.
- 낙관적 반영 + fire-and-forget 저장 금지: 저장 성공을 확인한 뒤 상태를 바꾼다. 캐시 기준으로 행 전체를 upsert하면 다른 필드가 지워지니 부분 patch를 쓴다.
- `.insert().select()`는 RETURNING 때문에 SELECT 정책까지 통과해야 한다. `upsert`는 수정이어도 INSERT의 WITH CHECK를 검사한다.
- RLS: 쓰기 정책을 `using(true)`로 두지 않는다. RLS 정책에서 다른 RLS 테이블을 인라인 EXISTS로 참조하지 말고(양방향이면 무한 재귀 → 전부 500) SECURITY DEFINER stable 함수로 감싼다. 민감 컬럼은 필드 가리기가 아니라 컬럼 권한 회수 + RPC/뷰로 노출한다(anon 키는 번들에 공개된다).
- 유한한 값 집합의 text 컬럼에는 CHECK 제약을 건다. 파생 스냅샷·캐시 테이블은 원본이 바뀌는 모든 경로에서 동기화한다.
- 운영 DB 조회·대형 백필은 사용자 확인 후 한다. 522나 schema cache 에러가 나면 모든 DB 접근을 즉시 멈춘다. 대형 백필은 1만 건 단위로 끊고 pause를 두며 재개 가능하게(`where 처리컬럼 is null`) 만든다.
- 이름 매칭에서 지역 같은 타이브레이커는 후보가 1개뿐이어도 대조한다("후보 1개면 채택"은 오매칭이 났다).

### 웹 (React 18 + Tailwind v4 + Zustand)
- 제출·삭제 핸들러의 재진입 가드는 `useRef`로 한다. `if (busy) return; setBusy(true)`는 모바일 더블탭에 뚫려 중복 생성된다.
- 네이티브 `alert`/`confirm` 대신 toast·confirmDialog 헬퍼를 쓴다. 합계 100% 같은 정책 예외가 가능한 값은 하드 차단 대신 값을 보여주고 의도를 묻는다(하드 차단은 음수·필수 누락 같은 항상 틀린 값에만).
- 존재하지 않는 CSS 변수를 지어내지 않는다. Tailwind v4 `bg-(--x)`는 토큰이 없어도 빌드를 통과하고 런타임에 조용히 무효가 된다. 클래스명을 문자열 보간으로 만들지 않는다.
- 항상 마운트되는 컴포넌트(레이아웃·상단바·내비)에서 배럴(`index.ts`) import를 피하고, firebase 같은 무거운 의존성은 동적 import한다.
- 한글 UI에는 `word-break: keep-all`. 아이콘만 있는 버튼은 만들지 않고 짧은 텍스트 라벨을 함께 둔다(이모지 대신 lucide-react). 입력이 있는 모달은 배경 클릭으로 닫지 않는다.
- 관리 화면의 설정 UI는 실제 동작에 배선돼 있는지 확인한다(읽는 코드가 없는 "죽은 설정" 금지).
