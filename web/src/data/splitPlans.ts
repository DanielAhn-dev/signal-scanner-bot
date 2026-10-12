// 자동 생성 — scripts/research/build_split_plans.py. 직접 고치지 말고 스크립트를 다시 돌린다.
export type SplitPlanStat = {
  id: string; label: string; weights: number[]
  /** 시작 6개월 뒤 평가(원금=1): 평균·하위10%·최악 */
  avg: number; p10: number; worst: number
  /** 6개월 동안 도중 최저 평가(원금=1): 하위10%·최악 */
  minP10: number; minWorst: number
}

export const SPLIT_PLAN_META = {
  "title": "목돈 나눠 넣기 방식별 과거 결과",
  "asOf": "2026-10-12",
  "generated": "2026-10-12",
  "script": "scripts/research/build_split_plans.py",
  "sample": "KODEX 200 2002-10~2026-10 일봉(분배금 반영 수정주가), 시작일 5,794가지, 시작 후 6개월 시점",
  "caveat": "시작일이 겹쳐 독립 표본이 아님, 한국 지수 하나의 결과, 미투입 현금은 수익 0%로 계산, 고점 대비 -25% 이하에서 시작한 사례는 6번의 하락 구간뿐이라 따로 결론 내지 않음"
}

export const SPLIT_PLAN_STATS: SplitPlanStat[] = [
  {
    "id": "front",
    "label": "절반 먼저",
    "weights": [
      0.5,
      0.25,
      0.25
    ],
    "avg": 1.075,
    "p10": 0.901,
    "worst": 0.536,
    "minP10": 0.844,
    "minWorst": 0.53
  },
  {
    "id": "even3",
    "label": "균등 3회",
    "weights": [
      0.3333,
      0.3333,
      0.3333
    ],
    "avg": 1.071,
    "p10": 0.9,
    "worst": 0.537,
    "minP10": 0.849,
    "minWorst": 0.533
  },
  {
    "id": "even6",
    "label": "균등 6회",
    "weights": [
      0.1667,
      0.1667,
      0.1667,
      0.1667,
      0.1667,
      0.1667
    ],
    "avg": 1.049,
    "p10": 0.925,
    "worst": 0.574,
    "minP10": 0.885,
    "minWorst": 0.574
  },
  {
    "id": "lump",
    "label": "한 번에",
    "weights": [
      1.0
    ],
    "avg": 1.087,
    "p10": 0.895,
    "worst": 0.528,
    "minP10": 0.824,
    "minWorst": 0.499
  }
]
