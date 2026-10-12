# 종목 분석 (`analyze`)

종목 코드·이름으로 조회해 현재가, 투자지표, 수급·기술, 공매도/신용, 캔들 차트, 규칙 판정(어드바이저)을 한 화면에 보여준다. 결과에서 시뮬레이터 추가, 실행가이드로 보내기, 링크 공유로 이어진다.

## 구조

| 폴더 | 역할 | 규칙 |
|---|---|---|
| `index.tsx` | 훅을 부르고 파생값을 계산해 섹션 컴포넌트에 넘긴다 | 조회·판정 로직을 직접 넣지 않는다 |
| `hooks/` | `useAnalyzeData`(조회·결과 상태·주소 갱신·마운트 이어받기), `useAnalyzeActions`(시뮬레이터 추가·실행가이드·공유), `useLocalStorageBool`(차트 토글 저장), `useRecentSearches`(최근 조회 5개) | **호출 순서 = 효과 실행 순서**: 주소 갱신 → 마운트 이어받기(조회) |
| `lib/` | 순수 계산: `validation`(갭 검증·충족도·진입 판단), `candles`(정규화·지지/저항), `narrative`(서술 신호), `styles`, `flow`, `dates`, `shareSummary`, `shareUrl` | 테스트 `helpers.test.ts`, `derived.test.ts` |
| `components/` | `SearchHeader`, `ResultHead`, `DecisionCard`, `PriceRangeBar`, `MarketRatiosSection`, `FlowShortSection`, `CandleSection`, `SummarySection`, `AdvisorSection`, `Divider` | 필요한 값만 props로 받는다 |
| `types.ts` / `constants.ts` | 신호 톤 / 세션 키 | |

## 다른 화면과의 계약 (바꾸지 않는다)

- 기본 내보내기 `AnalyzePage({ onNavigate? })` — `App.tsx`가 lazy로 불러온다.
- 들어오는 방식: URL `?code=`와 `sessionStorage`의 `analyze_pending_code`(`backtest`, `scan`, `discovery`, `highlights` 등이 씀). URL이 우선이고 세션 키는 값이 있으면 항상 지운다.
- 나가는 방식: `execution_guide_pending_v1`(`{ codes, source: 'analyze' }`)과 시뮬레이터 계획(`planStore`). 조회 후 주소는 `buildAnalyzeShareUrl`로 `replaceState`한다.

## 데이터

- `GET /api/ui/stock-latest?code=&chat_id=` — 프로필·최신가·캔들·수급·신용공매도·어드바이저를 한 번에
- `/api/ui/route-share` — 링크 공유(`useShareManager`, `kind: 'analyze'`)
- 공시 점검·추격 경고는 공용 컴포넌트가 따로 조회

## 주의

- `analyze()`는 시작할 때 결과·수급·신용·어드바이저·캔들을 모두 비운 뒤 채운다(이전 종목이 잠깐 보이지 않게).
- 지표(SMA/EMA/RSI)는 **서버 값을 그대로** 쓴다. 클라이언트 재계산은 서버와 불일치를 낳으므로 만들지 않는다.
- 진입 판단(`decideEntry`)의 분기 순서는 결과를 결정한다: 판정·현재가 없음 → 동기화 검증 실패(진입 구간과 현재가가 3배 초과 또는 2배 초과) → 충족도 2 이하(데이터 부족) → 두 단계 행동별(진입 검토/비중 축소/그 외). 순서를 바꾸지 않는다.
- 어드바이저 섹션의 진입구간·손절·목표는 "고정 규칙(손절 5.5~8%·목표 3~18%)으로 만든 가격이며 예측이 아니다"라는 안내 문구를 함께 보여준다. 문구를 옮기거나 고칠 때 이 원칙(주장 범위를 검증된 것으로 제한)을 지킨다.
- 차트 토글 키(`chart.showHud` 등)와 최근 조회 키(`analyze.recentSearches`, 사용자별)를 바꾸면 사용자 설정·기록이 초기화된다.
- `lib/styles.ts`의 `scoreColor`와 `lib/flow.ts`의 `formatCompactKrw`는 현재 어떤 화면에서도 쓰이지 않는다(분해 전부터). 테스트로만 고정돼 있으니 지울 때는 테스트도 함께 정리한다.
- 서버 응답(`result`, `flow`, `advisor`)은 `any`다. 타입을 정의하려면 서버 응답과 함께 별도로 한다.
- 스모크 테스트(`index.test.tsx`)가 조회, 이어받기, 진입 판단 분기, 최근 조회, 시뮬레이터/실행가이드 이동, 공유를 고정한다. 차트·공시 점검은 mock이라 다루지 않는다.
