# 내 선택 돌아보기 · 코어 프로필 계획 (2026-10-02)

다른 PC에서도 이어서 작업할 수 있도록 맥락·결정·남은 일을 한곳에 적는다. 코드와 같이 커밋해 둔다.

## 배경 (사용자 방향)

- 시작은 지수 보유(초보자)로 하되, 소액으로 재미를 보고 싶은 사람·인컴을 받고 싶은 사람의 욕구는 막지 않는다. 막는 대신 **선택의 결과를 눈에 보이게** 돌려준다.
- 전환하는 시점부터 두 갈래(실제 vs "안 바꿨다면")를 병행해 보여주고, 분기·연 단위로 점검(리밸런싱·내년 계획)한다.
- 자금이 모인다고 종목 봇으로 자동 전환하지 않는다. 검증에서 종목 선별은 시드 크기와 무관하게 지수를 못 이겼고, 종목 봇의 이점은 낙폭 완화(최악 -39% → -11%)뿐이었다. 전환은 "제안 → 확인" 구조.
- 후보를 다양하게 두는 목적은 **전향 측정**이다. 과거 데이터에서 좋았던 조합을 고르면 후보가 많을수록 우연이 섞인다.

## 이번에 만든 것 (1단계) — 상태: 코드 완료, 화면 미확인

| 구성 | 파일 |
|---|---|
| 계산(순수 함수)·입력 검증 | `src/services/choiceReview.ts`, `tests/choiceReview.test.ts` |
| 서버 경로 `POST /api/ui/choice-review` | `handlers/ui/choice-review.ts`, `api/ui.ts` 라우트 등록 |
| 전환 기록 저장(사용자 설정 `switchHistory`) | `web/src/lib/switchHistory.ts`, `web/src/lib/userState.ts`, `handlers/ui/user-state.ts`(키 추가, 한도 8KB) |
| 전환 시 기록 호출 | `web/src/features/settings/index.tsx`의 `saveStrategyMode` |
| 화면 `/choices` | `web/src/features/choice-review/`, `web/src/navigation.ts`, `web/src/App.tsx` |
| 인증 헤더 대상 | `web/src/lib/api.ts`의 `needsAuthHeader`에 `choice-review` |

정의와 규칙
- "안 바꿨다면" = 전환 시점의 보유 종목을 그대로 들고 있었다면(이후 매매·입금 없음). 종목 봇이 계속 매매했다면은 재현 불가.
- 실제 = 목표 트래커 일별 평가액을 이은 수익률(`goalTracker.chainedReturn`과 같은 규칙, 입금한 날은 수익 0).
- 전환 후 30일(`MIN_REVIEW_DAYS`)이 지나기 전에는 숫자를 내지 않는다(잡음 + 잦은 갈아타기 유도 방지).
- 과거 전환은 기록이 없다. 앞으로 바꾸는 시점부터 쌓인다.

검증하지 못한 것
- 화면 렌더링과 실제 방식 전환 → 기록 → 30일 뒤 비교 흐름(실사용 확인 전).
- 가격 이력(`getDailySeries`)을 서버에서 가져오는 경로는 배포·로컬 API에서만 확인 가능(`pnpm dev:full`).

## 남은 일 (우선순위 순)

1. **분기 점검 카드**: 비중 이탈 확인과 리밸런싱 제안을 홈에 한 줄로. 기존 리밸런싱 가이드(`src/lib/incomeGuide.ts`)의 점검 기록을 재사용.
2. **연간 리뷰·내년 계획**: 지난 1년 선택별 결과 + 목표·적립액·구성 조정 제안.
3. **코어/위성 구조**: 방식을 "지수 코어(기본) + 종목 봇 위성(비중 상한, 선택)"으로. 위성 상한 기본값은 시드의 10% 안팎 제안(기존 "남는 현금은 시드의 10% 초과분만 지수" 규칙과 맞춤) — **사용자 확정 필요**.
4. **코어 프로필(성장 / 균형 올웨더형 / 인컴)**: 구성 ETF와 비중을 정하고 전향 측정 코드(`reviewStrategies`, `forward-test` 기록)에 병행 측정으로 얹기. 승격 기준은 결과를 보기 전에 고정(기존: 40거래일 이상, KODEX 200·CD금리 모두 앞섬, 낙폭 같거나 작음; 후보가 많으니 여러 기간 일관성도 요구).
5. **전환은 자동이 아니라 제안 + 확인**: 바꾸면 보유분 매매로 세금·수수료가 드니 비용을 보여준 뒤 확인.
6. **종목 봇을 반대편 트랙으로 보여주기**: 계정을 별도로 병행해 돌려야 재현 가능(비용 발생) — **필요 여부 사용자 확정 필요**.
7. 사용자의 구성·성향·유지 여부를 저장해 코호트 분석(`handlers/ui/cohort-analysis.ts` 위에). 수익률뿐 아니라 "하락 때 중도 이탈했는지"가 핵심 지표일 수 있음.

## 근거 상태 (화면에 정직하게 표시할 것)

- 성장(KODEX 200 / TR): 2026-10-02에 일반 7종·TR 8종 일봉 확보(`.research-cache/index_etfs/`, private 캐시 저장소). TR − 일반(세후) 연 +0.39%p(2021-10~). **적립 시뮬레이션은 아직 안 함**.
- 균형(올웨더형): 한국 ETF 상장 이력이 짧아 검증 가능 기간부터 확인 필요. 미검증.
- 인컴(커버드콜·배당): 분배율 ≠ 지속 가능한 인출률, 한국 상품 이력이 짧음. **네이버 일봉은 분배금이 소급 반영된 수정주가**라 분배금을 또 더하면 이중 계산 — 이전 고배당 재투자 결론(10년 중앙값 3.09~4.22배)은 과대평가였고 보정 시 1.86/2.09/2.55배 vs 지수 1.67배, 커버드콜은 5년 승률 0~18%. `validate_income_multistart.py`는 아직 수정 안 함, `incomeGuide.ts` 문구 재검토 필요.
- 미검증 구성은 화면에 "측정 중, 결과 확정 전"으로 표시한다.

## 이어서 작업하는 방법 (새 환경)

1. `git pull` 후 루트와 `web`에서 의존성 설치(`pnpm install`).
2. 로컬 실행: `pnpm dev:full` (API는 vercel dev, 웹은 vite). 서버 환경변수(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UI_READ_KEY` 등)는 `.env.local`에 필요 — 저장소에는 없다.
3. 테스트: 루트 `node scripts/run-tests.mjs`(서버), `web`에서 `npx vitest run`(웹), 타입체크 `npx tsc --noEmit`(루트)·`npx tsc --noEmit -p .`(web).
4. 서버 테스트 중 `tests/followReport.test.ts`, `tests/invites.test.ts`가 이 세션 시작 전부터 실패한다(원인 미확인, 이번 작업과 무관).
5. 분석 데이터(`.research-cache`)는 private 캐시 저장소에 있다. 다른 PC에서는 `scripts/research/fetch_index_etfs.py`로 다시 받거나 캐시 저장소를 받는다.

## 같은 세션에서 함께 바뀐 것 (참고)

- 시작하기: 성향 5문항 + 답에 맞춘 설정 자동 적용(`personalSetup`, `web/src/lib/startPlan.ts`), 미완료 사용자 /start 강제(`web/src/lib/useStartGate.ts`).
- 홈 대시보드: 오늘의 시장·뉴스, 실계좌 보유 종목별 대응(`web/src/lib/holdingAdvice.ts`, 단일 종목 비중 한도 안전형 5%·균형형 10%는 **검증값이 아닌 보수적 가정**).
- 시드 만들기 이번 달 계획 ↔ 월 자동 입금 한 값으로 동기화, 지수 ETF 매매를 결정 로그에도 기록(`virtualAutoTradeCashSweepStep.ts`의 `appendDecisionLog`).
