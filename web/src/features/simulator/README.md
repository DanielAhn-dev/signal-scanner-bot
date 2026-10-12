# 시뮬레이터 (`simulator`)

넣을 돈과 종목을 정하면 잘 풀릴 때·안 풀릴 때 손익을 미리 보여준다. 종목 추천(알고리즘·관심종목·현재 종목), 두 추천 비교, 계획 저장(로컬/서버)과 텔레그램 전송을 한 화면에서 한다.

## 구조

| 폴더 | 역할 | 규칙 |
|---|---|---|
| `index.tsx` | 훅을 부르고 섹션 컴포넌트에 props로 넘긴다 | 조회·계산을 직접 넣지 않는다 |
| `hooks/` | `useSimulatorPlan`(투자금·종목·비용 가정·파생 계산), `useStockSearch`(종목 추가 검색), `useCandidates`(후보 조회), `useRecommendation`(추천·비교 패널), `usePlanSync`(저장·불러오기·히스토리·전송) | **호출 순서 = 효과 실행 순서**: 시드 반영 → 검색 → 후보 조회 → 추천 재계산 → 서버 계획 불러오기 |
| `lib/` | 순수 계산: `algoCandidates`(스캔 후보+하이라이트 병합), `watchlistCandidates`, `recommend`(성향 폴백), `summary` | 테스트 `lib/logic.test.ts` |
| `components/` | `SummaryCard`, `RecommendSection`, `SettingsPanel`, `ItemsSection`(+`ItemCard`), `GoalPathSection`, `ScenarioSection`, `ComparePanel`, 작은 표시 컴포넌트 | 필요한 값만 props로 받는다 |
| `telegramFormat.ts` | 기대값·켈리·손익비·추천 포트폴리오·텔레그램 메시지 계산(순수) | 이 파일의 기준을 바꾸면 추천 결과가 달라진다 |
| `planStore.ts` | 화면 간 전달용 작업본(localStorage, 사용자별 키) | |
| `types.ts` / `constants.ts` | 추천 소스·비교 결과·히스토리 타입 / 시나리오 등락률 | |

## 데이터

- `GET /api/ui/scan-candidates?limit=80`, `GET /api/ui?route=scan-highlights` — 알고리즘 후보(항상 조회)
- `GET /api/ui/positions?positionType=interest&chat_id=` — 관심종목(연동된 계정만)
- `GET|POST /api/ui/simulation-plan` — 서버 최신 계획·히스토리·저장
- `POST /api/ui/notify` — 텔레그램 전송

## 주의

- **서버 계획 불러오기 건너뛰기**: 시드 만들기에서 넘어왔거나 로컬 계획에 종목이 있으면 마운트 시 서버 최신 계획을 부르지 않는다. 이 분기를 지우면 종목이 비는 사고가 되살아난다.
- 투자금 기본값 덮어쓰기는 "시드 만들기에서 오지 않았고 계획에 투자금이 없을 때"만 한다.
- 추천 패널이 열려 있을 때만 월 목표·소스·성향·투자금·후보·종목 변경에 반응해 재계산한다. `useRecommendation`의 의존 배열을 줄이면 오래된 추천이 남는다.
- 알고리즘 후보는 목표 +5%/손절 −3%에 실측 환산 승률로 만든다. 손익비 1.67이라 가장 보수적인 성향(최소 1.9)을 통과하지 못하므로 알고리즘 소스 추천은 대부분 "추천 가능한 종목이 없습니다"가 나온다(현재 동작, 테스트가 고정).
- `useCandidates`의 알고리즘 후보 조회에는 진단용 `console.log`가 남아 있다. 제거는 별도 커밋으로 한다.
- 기본값 매직 넘버(가격 정보가 없으면 50,000원, 등급 D 제외, 균형 폴백 순서)는 의도된 동작이다. 바꿀 때는 `lib/logic.test.ts`를 함께 고친다.
- 스모크 테스트(`index.test.tsx`)는 후보 조회, 서버 계획 건너뛰기, 시드 만들기, 행 추가/제거, 추천 생성·적용·재계산, 저장·전송을 고정한다. 구조를 바꿀 때 먼저 돌린다.
