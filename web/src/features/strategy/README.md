# 전략 대시보드 (`strategy`)

자동매매 전략 선택·설정, 결정 이력 현황, 성장 기록(누적 실현손익·이동 승률)과 급등 전 패턴 리포트를 보여준다.

## 구조

| 폴더 | 역할 | 규칙 |
|---|---|---|
| `index.tsx` | 훅을 부르고 파생값을 계산해 탭 컴포넌트에 props로 넘긴다 | 화면 로직·API 호출을 직접 넣지 않는다 |
| `hooks/` | 데이터 로딩·저장 (API별 1개) | 각 훅이 마운트 시 스스로 로드하고 `load`를 돌려준다. `usePreRallyReport`만 기간 변경 시 다시 로드 |
| `lib/` | 순수 계산 (`decisionSummary`, `growthTimeline`, `profitTrend`, `rollingWinRate`, `preRally`, `labels`, `chartMath`) | 테스트는 `calculations.test.ts`, `pureHelpers.test.ts` |
| `components/` | `OverviewTab`·`SettingsTab`·`GrowthTab`, `ForwardTestPanel`(전향검증 패널, 탭과 무관하게 항상 표시) | 각 탭은 필요한 값만 props로 받는다 |
| `types.ts` / `constants.ts` | 타입 / 전략 옵션·라벨 맵·색 토큰 | 전략을 추가하면 `STRATEGY_OPTIONS`와 서버 전략 정의를 함께 고친다 |

## 데이터

- `GET /api/ui/decisions?pageSize=200` — 결정 이력(현황 요약·성장 타임라인)
- `GET|POST /api/ui/settings` — 자동매매 설정. 저장 성공 응답으로 상태를 갱신한다
- `GET /api/ui/operations?view=activity` — 거래 활동(실현손익 추이, 이동 승률)
- `GET /api/ui/strategy-adaptive`, `GET /api/ui/pre-rally-patterns?horizon=` — 적응형 요인, 급등 전 패턴 리포트

## 주의

- 화면에 보이는 전략 설명(`STRATEGY_OPTIONS`)은 실제 동작과 맞아야 한다. `REDUCE_TIGHT`의 손절선은 고정 2%가 아니라 변동성(ATR)에 따라 기본폭의 최대 2.5배까지 넓어진다.
- 누적 손익은 `pnl_amount`(수수료·세금 반영 순손익)의 SELL 행만 합산한다.
- 성장 타임라인 키는 결정 `id`가 없으면 `Math.random()`을 쓴다(알려진 한계, 동작 유지).
- 스모크 테스트(`index.test.tsx`)가 탭·정렬·새로고침 API 5개·설정 저장 본문을 고정한다. 구조를 바꿀 때 먼저 이 테스트를 돌린다.
