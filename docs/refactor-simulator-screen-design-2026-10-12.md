# simulator 화면 분해 설계 (2026-10-12)

`web/src/features/simulator/index.tsx` 1684줄. 동작은 바꾸지 않고 `portfolio`·`scan`·`strategy`·`backtest`와 같은 순서(특성화 테스트 → 순수 로직 → 컴포넌트 → 훅 → 정리)로 나눈다. 이 문서는 설계만이며 코드는 아직 바꾸지 않았다.

## 현재 구조 (측정)

| 줄 | 내용 |
|---|---|
| 1–42 | import, `SCENARIOS` |
| 45–270 | 작은 컴포넌트 5개: `GradeChip`, `PositionStatusBadge`, `RRBar`, `NumInput`, `ComparePanel`(약 155줄) |
| 270–335 | `SimulatorPage` 상태 선언 30여 개(투자금·종목·설정·추천·비교·히스토리·모달) |
| 337–378 | 파생 계산 `useMemo` 5개: `summary`, `scenarioRows`, `itemMeta`, `statusMeta`, `weeklyPlan` |
| 379–395 | 종목 행 편집: `updateItem`, `addRow`, `removeRow` |
| 396–535 | 추천 로직: `getCandidatesBySource`, `recommendWithStyleFallback`, `generateRecommendation`, `applyRecommendation`, `generateCompare`, 재계산 `useEffect` 2개 |
| 537–745 | 후보 조회: `loadWatchlistCandidates`(관심종목), `loadAlgoCandidates`(스캔 후보 + 하이라이트 병합, 약 165줄, `console.log` 다수) |
| 749–866 | 계획 저장·불러오기: `buildPlan`, `applyPlan`, `saveLocal`, `saveServer`, `loadServer`, `sendTelegram`, `loadHistory`, `loadFromHistory` |
| 868–1684 | JSX: 헤더 → 요약 카드 → 종목 추천(`<details>`) → 설정 패널 → 종목 목록(약 280줄) → 목표 달성 경로 → 시나리오 분석 → 시세 상세 모달 |

이미 분리된 것: `telegramFormat.ts`(485줄, 계산·추천·메시지 순수 함수 다수), `planStore.ts`(85줄, 로컬 저장). 따라서 순수 계산 이동은 적고, 이득은 **JSX 분리 + 상태·조회 훅 분리 + 후보 병합 로직의 lib화 및 테스트**에 있다.

## 목표 구조

```
simulator/
  index.tsx                 훅 호출 + 섹션 컴포넌트 배치 (목표 250줄 이하)
  types.ts                  RecommendSource, CompareResult, PlanHistoryEntry, SimulatorSummary
  constants.ts              SCENARIOS
  planStore.ts / telegramFormat.ts   (유지)
  lib/
    algoCandidates.ts       scan-candidates + scan-highlights → HighlightPlanItem[] 병합 (loadAlgoCandidates의 순수 부분)
    watchlistCandidates.ts  positions 응답 → HighlightPlanItem[] 변환
    recommend.ts            recommendWithStyleFallback, getCandidatesBySource, countTradeable, 스타일 순서
    summary.ts              summary / scenarioRows / itemMeta 계산 (useMemo 본문)
  hooks/
    useSimulatorPlan.ts     totalCapital, items, memo, 투자금 시드 반영, updateItem/addRow/removeRow
    useCandidates.ts        알고리즘·관심종목 후보 조회와 로딩 상태
    useRecommendation.ts    소스·성향·추천/비교 패널 상태, 열린 동안 자동 재계산 effect 2개
    usePlanSync.ts          saveLocal/saveServer/loadServer/sendTelegram/히스토리, 마운트 시 서버 불러오기
    useStockSearch.ts       종목 추가 검색(디바운스 100ms)
  components/
    GradeChip.tsx, PositionStatusBadge.tsx, RRBar.tsx, NumInput.tsx   (기존 작은 컴포넌트)
    ComparePanel.tsx
    SummaryCard.tsx, RecommendSection.tsx, SettingsPanel.tsx(+히스토리), ItemsSection.tsx(+ItemCard), GoalPathSection.tsx, ScenarioSection.tsx
  README.md
```

## 단계

0. **스모크 테스트**로 현재 동작 고정. 가짜 API와 가짜 `useCurrentChatId`·`useSeedCapital`·`react-router`·토스트를 쓴다. 고정할 것:
   - 마운트 시 후보 조회 2종(`scan-candidates`, `scan-highlights`), chatId 있으면 관심종목, 계획이 비어 있으면 서버 최신 계획 조회
   - 종목 추가 → 행 수 증가, 삭제, 투자금 입력이 요약의 남은 금액에 반영
   - 추천 생성 → 패널 표시, 적용 → 종목 교체
   - 로컬 저장·서버 저장 호출 본문, 텔레그램 전송
   - 시드 만들기에서 넘어온 투자금 배너
1. `types.ts`·`constants.ts`, 작은 컴포넌트 5개와 `ComparePanel`을 `components/`로 이동.
2. 순수 로직 추출 + 단위 테스트: `algoCandidates`(병합 규칙: D등급 제외, 하이라이트가 후보를 덮는 방식, 기본 가격 50,000), `watchlistCandidates`, `recommend`(스타일 폴백 순서), `summary`. 테스트의 기대값은 분리 전 코드로 확인한다.
3. 섹션 JSX를 컴포넌트로: `SummaryCard`, `RecommendSection`, `SettingsPanel`, `ItemsSection`(가장 큼), `GoalPathSection`, `ScenarioSection`.
4. 훅으로: 위 5개. 효과 실행 순서(후보 조회 → 서버 불러오기 → 추천 재계산)를 유지한다.
5. 미사용 props·죽은 코드 정리, README.

## 주의 (동작 유지)

- **마운트 시 서버 불러오기 조건**: `fromSeedBuilder`이거나 로컬 계획에 종목이 있으면 서버 계획을 부르지 않는다. 이 분기를 훅으로 옮길 때 그대로 둔다(과거에 종목이 비는 사고가 있었다).
- **투자금 시드 반영 effect**: 시드 만들기에서 오지 않았고 계획에 투자금이 없을 때만 `useSeedCapital` 값으로 덮는다.
- **추천 재계산 effect 의존 배열**: 패널이 열려 있을 때만 월 목표·소스·성향·투자금·후보·종목 변경에 반응한다. 의존 배열을 줄이면 오래된 추천이 남는다.
- `loadAlgoCandidates`의 `console.log`는 분해 중 유지하고, 제거는 별도 커밋. 기본 목표 5%·손절 3%·승률은 `empiricalWinProb` 실측 환산이라는 주석을 lib로 옮길 때 보존한다.
- 관심종목 후보를 만들 때 가격 기본값 50,000원, 등급 D 제외 같은 매직 값은 바꾸지 않는다.
- `telegramFormat.ts`와 웹 외 서버 코드에 같은 계산 사본이 있는지는 이 작업 범위가 아니다. 분해 중 발견하면 기록만 한다.
- CSS(`sim-*`)는 다른 화면과 공유될 수 있어 옮기지 않는다.

## 위험과 순서 판단

- 가장 위험한 부분은 4단계(훅 분리)에서 effect 순서와 `setItems` 호출 시점이 바뀌는 것이다. 0단계 테스트에 "서버 계획 불러오기 건너뛰기"와 "추천 패널 열린 채 월 목표 변경" 두 시나리오를 반드시 넣는다.
- 3단계에서 `ItemsSection`이 props를 가장 많이 받는다(종목 행 편집·상태·메타·확장 인덱스). 이때 `ItemCard`를 따로 두어 행 단위로 나누고, 행 단위 props는 `item`, `meta`, `status`, `onChange`, `onRemove` 정도로 줄인다.
- 예상 시간: 0단계가 가장 길다(의존 모듈 mock이 많다). 이후 단계는 `backtest`와 비슷한 규모.
