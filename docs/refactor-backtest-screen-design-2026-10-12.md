# backtest 화면 분해 설계 (2026-10-12)

`web/src/features/backtest/index.tsx` 1957줄. 동작은 바꾸지 않고 `portfolio`·`scan`·`strategy`와 같은 방식(특성화 테스트 → 순수 로직 → 컴포넌트 → 훅)으로 나눈다.

## 측정 (`web/src` 비테스트 tsx 상위)

| 파일 | 줄 | 비고 |
|---|---|---|
| features/backtest | 1957 | useState 31개, 한 컴포넌트에 순수 로직·데이터 로딩·화면 3탭 |
| features/simulator | 1684 | 훅 34 |
| features/execution-guide | 1651 | 함수 30 |
| features/operations | 1598 | 관리자 화면 |
| features/analyze | 1405 | |
| features/sectors | 1292 | |

`backtest`를 먼저 고른 이유: 가장 크고, 순수 판정 로직(`evaluateAutoPick`, `matchesRuleFilter`, 기대수익 추정, 규칙 매칭)이 컴포넌트와 섞여 있어 테스트 가능한 형태로 빼는 이득이 가장 크다.

## 구조 (목표)

- `types.ts`: `BacktestRiser`, `BacktestResponse`, `StockIndicators`, `RuleFilter`, `AutoPickItem`, `ScanCandidateLite`, 탭·정렬 키
- `constants.ts`: `HORIZONS`, 노출 Horizon, `STEPS`/`STEP_THRESHOLDS`/`TOTAL_SECONDS`, 세션 키
- `lib/`: `format`(pct·signedPct·clamp·toEok), `signal`(signalCls·isBuySignal), `ruleMatch`(matchesRuleFilter + 종목 점검의 규칙 일치 판정), `autoPick`(evaluateAutoPick·tier·기대수익), `meta`(matchMeta·confidenceMeta·pbrMeta), `navigation`(navigateTo·시뮬레이터 이동), 모두 테스트
- `hooks/`: `useBacktestRun`(파라미터·조회), `useStockCheck`(검색 디바운스·지표 조회·선택), `useAutoPicks`(스캔 후보 + 지표 → 추천, 현재 콘솔 로그 포함), `useReturnProfile`(필터 프로필), `useBacktestView`(정렬·파생값)
- `components/`: `BacktestSkeleton`, `ParamsCard`, `SummaryTab`, `CheckTab`, `SamplesTab`

## 단계

0. 스모크 테스트 6개로 현재 동작 고정 (**완료**)
1. types·constants·간단 lib(format·signal·meta) 분리
2. 판정 로직(ruleMatch·autoPick)을 lib로 빼고 단위 테스트(분리 전 코드 기준 기대값)
3. 탭 3개와 스켈레톤·파라미터 카드를 components로
4. 데이터 로딩·상태를 훅으로
5. 정리, README

## 주의 (동작 유지)

- 자동 추천은 `selectedRule`·필터 4개가 바뀔 때마다 지표 36건을 조회한다. 이 호출 패턴은 건드리지 않는다.
- `console.log` 진단 출력이 자동 추천에 남아 있다. 분해 중에는 유지하고, 제거는 별도 커밋으로 한다.
- 규칙 일치 판정이 두 곳에 있다: 서버 규칙 필터(`matchesRuleFilter`)와 종목 점검의 하드코딩 키 매칭(`matchedRuleCandidates`). 같은 규칙의 사본이므로 분리하면서 한곳에 모을 수 있는지 `diff`로 확인하되, 값이 갈라져 있으면 그대로 두고 기록만 한다.
- 시뮬레이터 계획(`simulator/planStore`)과 `sessionStorage` 키 3개를 쓰는 이동 로직은 그대로 유지한다.
