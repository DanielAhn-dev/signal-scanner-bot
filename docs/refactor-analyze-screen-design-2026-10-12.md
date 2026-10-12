# analyze 화면 분해 설계 (2026-10-12)

`web/src/features/analyze/index.tsx` 1405줄(테스트 없음). 동작은 바꾸지 않고 `backtest`·`simulator`·`execution-guide`와 같은 순서(특성화 테스트 → 순수 로직 → 컴포넌트 → 훅 → 정리)로 나눈다. 이 문서는 설계만이며 코드는 아직 바꾸지 않았다.

## 현재 구조 (측정)

| 줄 | 내용 |
|---|---|
| 1–21 | import (차트, 공유, 공시 점검, 추격 경고 등 공용 컴포넌트가 많다) |
| 22–142 | 표시 도우미: 서술 신호(`pegNarrativeSignal`, `flowNarrativeSignal`, `shortNarrativeSignal`, `buildNarrativeLine`), 색·스타일(`toneStyle`, `scoreColor`, `advisorStatusStyle`, `regimeLabel`, `twoStageActionStyle`), 수급 표기(`getFlowMetricLabel`, `formatCompactKrw`, `formatFlowValue`), `buildAnalyzeShareUrl` |
| 144–196 | 컴포넌트 안에 정의된 소형 훅 2개: `useLocalStorageBool`(차트 토글 저장), `useRecentSearches`(최근 검색) |
| 197–255 | `AnalyzePage` 상태(결과·캔들·수급·신용공매도·어드바이저·로딩·오류·차트 토글), `goRoute`, 시뮬레이터 추가·실행가이드 보내기, 공유 매니저 |
| 256–335 | 파생 계산 `useMemo` 3개: `dataValidation`(진입가-현재가 갭 검증), `analysisCoverage`(5개 데이터 충족도), `entryDecision`(진입 판단 라벨) |
| 336–425 | `analyze()` 조회(캔들 정규화 포함), 주소 갱신 effect, 마운트 시 `?code=`/세션 이어받기 |
| 426–572 | 날짜 포맷 2개, `priceBarPct`, `shareSummaryLines`, `chartHud`(지지·저항), `signalText`, `onShareAnalyze` |
| 573–1405 | JSX 약 830줄: 검색 헤더 표 → 로딩/오류 → 결과(헤더 표, 추격 경고·공시 점검, 현재 판단 카드, 일중 범위 바, 시장 데이터, 투자지표, 수급/기술, 공매도·신용, 캔들 차트(약 110줄), 현황 요약, 어드바이저(약 195줄), 섹터) → 공유 모달 |

핵심 관찰: **JSX가 절반 이상**(830줄)이고 섹션이 뚜렷하게 나뉜다. 순수 로직은 위쪽 120줄과 파생 계산 3개 정도로 `execution-guide`보다 적다. 이득은 섹션 컴포넌트 분리와 조회·이어받기 훅 분리에 있다. 타입이 거의 `any`(`result`, `flow`, `advisor`)라, 타입 정의를 추가할 때 서버 응답과 어긋나지 않게 **선언만 하고 `any` 값은 그대로** 둔다.

## 바깥에서 이 화면에 의존하는 계약 (바꾸지 않는다)

- 기본 내보내기 `AnalyzePage({ onNavigate? })`. `App.tsx`가 `lazyWithRecovery(() => import('./features/analyze'))`로 불러온다.
- 다른 화면이 종목을 넘기는 방식: `sessionStorage`의 `analyze_pending_code`(`backtest/lib/navigation.ts`, `scan`, `discovery`, `highlights` 등이 쓴다)와 URL `?code=`. 마운트 시 한 번 읽고 세션 키는 지운다.
- 이 화면이 다른 화면으로 넘기는 방식: `execution_guide_pending_v1`(`{ codes, source: 'analyze' }`)과 시뮬레이터 계획(`planStore`).
- 조회 후 주소를 공유용 URL로 `replaceState`한다(`buildAnalyzeShareUrl`).
- 서버 API: `stock-latest`(`chat_id` 포함), `route-share`(`useShareManager`), 하위 컴포넌트가 부르는 공시 점검.

## 목표 구조

```
analyze/
  index.tsx                  훅 호출 + 섹션 배치 (목표 250줄 이하)
  types.ts                   SignalTone, NarrativeSignal, (선택) AnalyzeCoverage·EntryDecision
  constants.ts               세션 키(analyze_pending_code, execution_guide_pending_v1), 차트 토글 키
  lib/
    narrative.ts             peg/flow/short 서술 신호, buildNarrativeLine
    styles.ts                toneStyle, scoreColor, advisorStatusStyle, regimeLabel, twoStageActionStyle
    flow.ts                  getFlowMetricLabel, formatCompactKrw, formatFlowValue
    shareUrl.ts              buildAnalyzeShareUrl
    candles.ts               normalizeCandles(서버 series → OhlcvCandle[]), calcChartHud(지지·저항)
    validation.ts            validateEntryGap, calcAnalysisCoverage, decideEntry
    shareSummary.ts          buildShareSummaryLines, buildSignalText, 날짜 포맷 2개
  hooks/
    useLocalStorageBool.ts, useRecentSearches.ts   (이미 있는 소형 훅을 그대로 이동)
    useAnalyzeData.ts        analyze(), 결과·캔들·수급·신용·어드바이저·로딩·오류, 주소 갱신 effect, 마운트 이어받기
    useAnalyzeActions.ts     goRoute, 시뮬레이터 추가, 실행가이드 보내기, 공유(onShareAnalyze)
  components/
    SearchHeader.tsx         검색 헤더 표(검색 입력·최근 검색)
    ResultHead.tsx           종목명·가격 헤더 표
    DecisionCard.tsx         현재 판단 + 데이터 충족도
    PriceRangeBar.tsx        일중 범위 바
    MetricGrids.tsx          시장 데이터·투자지표·수급/기술·공매도/신용 카드 그리드(4개를 한 파일 또는 각각)
    CandleSection.tsx        차트 + 토글 + HUD
    SummarySection.tsx       현황 요약(서술 신호 IIFE)
    AdvisorSection.tsx       어드바이저(판정 배지·진입/손절/목표·트레일링·근거·주의)
  README.md
```

## 단계

0. **스모크 테스트**로 현재 동작 고정. 가짜 API(`stock-latest`)·`CandleChart`·`DisclosureCheckCard`·`ChaseWarningNote`·`ShareModal`·`useShareManager`·토스트·`StockSearchInput`을 mock한다. 고정할 것:
   - 마운트 시 `?code=`/세션 `analyze_pending_code`를 읽어 자동 조회하고 세션 키를 지운다.
   - 조회 성공 시 종목명·가격·진입 판단 라벨이 나오고, 최근 검색에 쌓이며, 주소가 공유용 URL로 바뀐다.
   - 데이터가 부족하면(`analysisCoverage.available <= 2`) "데이터 부족", 진입가-현재가 비율이 3배를 넘으면 "판단 보류".
   - 어드바이저의 `twoStage.action`별 판단 라벨(진입 검토/비중 축소/관망).
   - 조회 실패·결과 없음 문구.
   - 시뮬레이터 추가가 계획에 종목을 더하고 `simulator`로 이동, 실행가이드 보내기가 세션 키를 쓰고 `execution-guide`로 이동(`onNavigate` 호출 확인).
   - 공유가 `route-share`를 `kind: 'analyze'` 페이로드로 부른다.
1. `types.ts`·`constants.ts`, 표시 도우미(narrative·styles·flow·shareUrl)를 `lib/`로 + 단위 테스트, 소형 훅 2개 이동.
2. 파생 계산(`candles`, `validation`, `shareSummary`)을 `lib/`로 + 테스트. 대표 입력의 진입 판단 라벨·충족도·갭 경고를 고정.
3. 섹션 JSX를 `components/`로(가장 큰 단계). 어드바이저·캔들 섹션이 가장 크다.
4. 훅으로: `useAnalyzeData`, `useAnalyzeActions`.
5. 정리와 README.

## 주의 (동작 유지)

- **`analyze()`는 시작할 때 결과·수급·신용·어드바이저·캔들을 모두 비운다.** 훅으로 옮겨도 "조회 시작 → 비우기 → 채우기" 순서를 유지한다(화면이 이전 종목을 잠깐 보이지 않게).
- **마운트 이어받기**: URL `code` 우선, 없으면 세션 pending. 세션 키는 값이 있으면 항상 지운다. 이 effect와 "결과가 생기면 주소 갱신" effect의 순서를 바꾸지 않는다(이어받기 → 조회 → 주소 갱신).
- 지표(SMA/EMA/RSI)는 **서버 값을 그대로 쓴다**(클라이언트 재계산은 서버와 불일치를 낳는다는 주석이 있다). 분해 중에도 재계산 코드를 만들지 않는다.
- `entryDecision`의 분기 순서(데이터 없음 → 동기화 검증 → 데이터 부족 → 두 단계 판단별)가 판단 라벨을 결정한다. 순서를 바꾸지 않는다.
- 어드바이저 섹션 주석에 진입구간·손절·목표가 "고정 규칙(손절 5.5~8%·목표 3~18%)으로 만든 가격이며 예측이 아니다"라고 되어 있다. 문구를 옮길 때 그대로 보존한다(주장 범위를 검증된 것으로 제한하는 원칙).
- `useLocalStorageBool`은 차트 토글 4개(`chart.showHud` 등)를 저장한다. 키 문자열을 바꾸면 사용자 설정이 초기화된다.
- `useRecentSearches`는 `userScopedKey`로 사용자별 키를 쓴다. 이동해도 키 조합(`analyze.recentSearches`)을 유지한다.
- CSS(`analyze-*`, `xls-*`, `cards-grid`)는 공유될 수 있어 옮기지 않는다.

## 위험과 판단

- 0단계: `CandleChart`(913줄 공용 컴포넌트)와 `DisclosureCheckCard`가 무거워 mock이 필수다. `StockSearchInput`도 mock하고 `analyze` 호출은 `onNavigate`/URL로 우회한다.
- 3단계: 섹션이 `result`·`flow`·`advisor`·`creditShort` 같은 `any` 객체를 읽으므로 props 수가 적고(객체 몇 개) 비교적 단순하다. `execution-guide`의 `GuideTable`처럼 3~5개 props로 끝나는 섹션이 많을 것으로 본다.
- 4단계: 조회 상태 7개가 한 훅에 모이고 `analyze`가 쿼리 상태(`query`)를 읽으므로 `query`는 `index.tsx`에 두고 인자로 넘긴다.
- 후속(분해와 별개): 서버 응답 타입(`StockLatestResponse`)을 `any` 대신 정의하면 이후 수정이 안전해지지만, 서버 변경과 맞물리므로 분해 후에 별도로 한다.
