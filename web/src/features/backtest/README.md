# 급등 종목 역추적 백테스트 (`backtest`)

최근 크게 오른 종목을 역추적해 상승 전 공통 패턴(점수·시그널·RSI)을 찾고, 현재 종목이 그 패턴에 얼마나 맞는지 점검한다. 탭 3개: 백테스트 결과 / 종목 점검 / 이벤트 샘플.

## 구조

| 폴더 | 역할 | 규칙 |
|---|---|---|
| `index.tsx` | 훅을 부르고 파생값을 계산해 탭 컴포넌트에 props로 넘긴다 | 조회·판정 로직을 직접 넣지 않는다 |
| `hooks/` | `useBacktestRun`(파라미터·조회·규칙 선택·마운트 시 실행), `useReturnProfile`(필터 프로필), `useAutoPicks`(스캔 후보 + 지표 → 추천), `useStockCheck`(검색·선택·지표 조회) | 호출 순서 = 효과 실행 순서. 바꾸지 않는다 |
| `lib/` | 순수 계산: `autoPick`·`ruleMatch`·`patternMatch`·`backtestView`·`format`·`signal`·`meta`, 이동은 `navigation`(sessionStorage·시뮬레이터 계획) | 테스트 `helpers.test.ts`, `logic.test.ts` |
| `components/` | `ParamsCard`, `SummaryTab`, `CheckTab`, `SamplesTab`, `BacktestSkeleton` | 필요한 값만 props로 받는다 |
| `types.ts` / `constants.ts` | 응답·지표·추천 타입 / Horizon·세션 키·진행 단계 | |

## 데이터

- `GET /api/ui/backtest-risers?horizon&lookbackDays&rallyPct&topN&_ts` — 규칙 후보, 공통 특징, 이벤트 샘플
- `GET /api/ui/scan-candidates?limit=60&includeIndicatorLiquidity=1` — 자동 추천의 후보 풀
- `GET /api/ui/stock-indicators?code=` — 종목 점검과 자동 추천(상위 36개를 하나씩 조회)

## 주의

- 자동 추천은 선택 규칙·필터 3개·프로필이 바뀔 때마다 지표를 36건 다시 조회한다. 호출 패턴을 바꾸려면 서버 부하를 먼저 본다.
- 기대수익은 "규칙에 맞은 모든 과거 사례의 평균"이다(급등 종목만의 평균은 사후 선택이라 쓰지 않는다). 일부 인자(`coreMatchCount` 등)는 시그니처에만 남아 있고 계산에 쓰이지 않는다.
- 종목 점검의 규칙 키 매칭(`isRuleKeyMatched`)은 서버 `handlers/ui/backtest-risers.ts`의 규칙 필터 사본이다. 서버 규칙을 바꾸면 `logic.test.ts`의 `SERVER_RULE_FILTERS`와 함께 고친다(동등성 테스트가 어긋남을 잡는다).
- `useAutoPicks`에는 진단용 `console.log`가 남아 있다. 제거는 별도 커밋으로 한다.
- `pct(null)`은 `'-'`가 아니라 `'0.0%'`를 돌려준다(`Number(null) === 0`). 현재 호출부에는 null이 들어오지 않는 것으로 보이며 테스트가 이 동작을 고정한다.
- 스모크 테스트(`index.test.tsx`)가 마운트 조회, 자동 추천 호출, 재실행·Horizon, 정렬, 샘플 → 종목 점검 이동, 오류 표시를 고정한다.
