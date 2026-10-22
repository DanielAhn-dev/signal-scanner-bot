# 시뮬레이터 (`plan-sim`)

과거 실제 월말 가격으로 "이 구성에 이렇게 넣었다면 지금 얼마"를 본다. 기간(빠른 선택·직접), 넣는 방식(일시금·월 적립·해마다 증액), 구성(최대 3개 비교), 리밸런싱을 고른다. 계획: `docs/plan-simulator-redesign-2026-10-22.md`.

## 구조

| 파일 | 역할 |
|---|---|
| `index.tsx` | 입력 상태·내 계획 구성 불러오기·계산(`useDeferredValue`) |
| `MixEditor.tsx` | 구성 한 줄 — 요약, [바꾸기]로 예시·자산별 비중 |
| `Results.tsx` | 결과 표(행=항목, 열=구성), 시작 달 분포 |
| `AmountChart.tsx` | 넣은 돈·평가금 그래프(금액 / 넣은 돈 대비 %) |
| `presets.ts` | 구성 예시, 자산군 이름, A·B·C |
| `StressSection.tsx` | 하락 가정(섞어보기에서 옮김) — 13자산 → 주식(리츠 포함)·채권·금·현금 묶음 |
| `SetPlanMix.tsx` | 이 구성을 내 계획으로 정하기(코스피200·S&P500·나스닥100만) |
| `DropPlanCard.tsx` · `BehaviorGap.tsx` | 하락 때 할 일 미리 정하기(`#drop-plan`) · 하락 중에 팔았다면(코스피200) |

계산은 `lib/sim/engine.ts`(섞어보기·모아가기와 같은 규칙, 불변 테스트), 기간은 `lib/sim/period.ts`, 자료는 `data/simData.ts`(`scripts/research/build_sim_data.py` 생성, 손으로 고치지 않음).

## 주의

- 순위·"최고의 조합"·자동 최적화는 넣지 않는다. 예시는 단순한 것부터, 과거 수익으로 고른 조합은 넣지 않는다.
- 비교하는 구성은 모두 같은 기간(교집합)으로 맞춘다. 이력이 짧은 자산이 기간을 정하면 화면에 알린다.
- 로그인했으면 A를 내 계획 구성(`investment-prefs`의 `plan.mix`)·매달 금액(`plan.monthly`)으로 채운다. 사용자가 먼저 바꿨으면 늦게 온 값으로 덮지 않는다.
- 세금·환전 비용은 넣지 않았다(계좌별 세금 옵션은 나중, 계획 8절).
- 섞어보기(`features/mix`)는 2026-10-22에 이 화면으로 합쳤다. 옛 `/mix`(·`#drop-plan`)는 `/plan-sim`으로 넘긴다(`REDIRECTED_ROUTES`).
- 시드 만들기에서 `state.seedBuilderCapital`로 오면 '처음에 한 번에'를 채운다(저장 안 함).
