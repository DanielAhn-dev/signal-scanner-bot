# 스캔 화면 (`눌림목(스윙/중기)`)

눌림목 후보를 단계(후보 → 확인 → 매수검토)와 전략(데이·오버나이트·주간)으로 거르고, 우선순위 순으로 표와 TOP 카드로 보여준다.

## 구조

| 폴더 | 역할 | 규칙 |
|---|---|---|
| `index.tsx` | 훅을 부르고 `ScanPanelState` 묶음을 만들어 컴포넌트에 넘긴다 | 로직을 넣지 않는다 |
| `hooks/` | 상태·조회·파생값·동작 (관심사별 1개) | 호출 순서: 화면 조건 → 데이터 → 파생값 → 동작 |
| `lib/` | 순수 계산 | 후보 판정은 `candidateStage.ts`, 점수는 `candidateScore.ts`, 세션 저장은 `snapshot.ts` |
| `components/` | 표시 컴포넌트 | `scan` 묶음에서 필요한 키만 `Pick`으로 받는다 |
| `types.ts` / `constants.ts` | 타입(`ScanCandidate`, `ScanPanelState`…) / 필터 옵션·전략 가이드·기본 정렬 | 새 조건 모드를 만들면 `ConditionFilter`, 옵션, 라벨, 기본 정렬 4곳을 함께 고친다 |

## 데이터

- `GET /api/ui/scan-candidates` — 후보 80개. 불러온 결과를 `sessionStorage`(`scan_snapshot_v1`)에 저장해 다음에 열 때 바로 보여준다.
- `scan-highlights`, `scan-strategy-metrics`(선택 기간 + 고정 30일), `scan-strategy-coverage`, `scan-strategy-drilldown`, `positions`(보유 종목 수)
- 신호 이력(`scan_signal_history_v1`)은 세션에만 쌓이며, 서버가 신호 나이를 주지 않는 종목의 D-1/D-2 판정에 쓴다.

## 주의

- TOP 카드(진입 A/B, 눌림 점수 순 상위 5개)는 필터가 "전체"일 때 표에서 빠진다. 머리글의 "N개 후보"도 TOP 카드를 뺀 표 기준이다.
- 엄격 퀵트레이드는 장중 변동 ±경계 근처에서 범위 조건보다 점수 기준(58)에서 먼저 탈락한다(`lib/candidateLogic.test.ts`에 고정).
- `CandidateTable`의 "눌림형/눌림 강함" 배지는 `isAccumulationSignal`이 표 행에 계산되지 않아 현재 표시되지 않는다. TOP 카드 항목에서만 채워진다.
- `strategy-metrics` 요청이 선택 기간과 고정 30일로 두 번 나간다(기간이 30일이면 중복).
- 효과 실행 순서가 첫 화면에 영향을 준다: 주소 파라미터(`?filter=`, `?sector=`) 초기화 → 후보 조회 → 기본 정렬 전환. 바꿀 때는 `index.test.tsx`의 URL·스냅샷 케이스를 먼저 본다.
- `scan-*` CSS는 `web/src/styles/index.css`에 있다(분리하지 않았다).
