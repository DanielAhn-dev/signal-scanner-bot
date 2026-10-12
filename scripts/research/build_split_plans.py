# -*- coding: utf-8 -*-
"""
웹 '모아가기' 화면의 "목돈 나눠 넣기" 카드용 정적 데이터 생성 (web/src/data/splitPlans.ts).

입력: .research-cache/index_etfs/px_069500.json (KODEX 200 네이버 일봉, 분배금 소급 반영 수정주가, 2002-10~)
방법: 시작일마다(2003-10~) 방식별로 월(21거래일) 간격 매수 뒤 시작 6개월(126거래일) 시점의 평가를 계산한다.
      평가 = 원금 1 기준, 미투입 현금은 수익 0%로 둔다. 도중 최저 평가는 시작 후 3거래일마다 본다.
결과: 평균·하위10%·최악·도중 최저 하위10%. 표본은 시작일이 겹쳐 독립이 아니다.
주의: 분할은 수익을 늘리는 방법이 아니다 — 평균은 일시금이 높고, 분할은 도중 낙폭과 하위 결과를 줄인다.
갱신: python scripts/research/fetch_index_etfs.py && python scripts/research/build_split_plans.py
"""
import datetime
import json

SRC = ".research-cache/index_etfs/px_069500.json"
OUT = "web/src/data/splitPlans.ts"
MONTH = 21
HORIZON = 6 * MONTH
STEP = 3

PLANS = [
    ("front", "절반 먼저", [0.5, 0.25, 0.25]),
    ("even3", "균등 3회", [1 / 3, 1 / 3, 1 / 3]),
    ("even6", "균등 6회", [1 / 6] * 6),
    ("lump", "한 번에", [1.0]),
]

px = sorted(json.load(open(SRC, encoding="utf-8")))
c = [float(v) for _, v in px]
n = len(c)


def quantile(sorted_vals, q):
    return sorted_vals[int(len(sorted_vals) * q)]


def evaluate(weights, s, i):
    shares, paid = 0.0, 0.0
    for k, w in enumerate(weights):
        if s + k * MONTH <= i:
            shares += w / c[s + k * MONTH]
            paid += w
    return shares * c[i] + (1 - paid)


plans = []
starts = 0
for pid, label, w in PLANS:
    ends, mins = [], []
    for s in range(0, n - HORIZON):
        ends.append(evaluate(w, s, s + HORIZON))
        mins.append(min(evaluate(w, s, s + d) for d in range(0, HORIZON + 1, STEP)))
    starts = len(ends)
    ends.sort()
    mins.sort()
    plans.append({
        "id": pid, "label": label, "weights": [round(x, 4) for x in w],
        "avg": round(sum(ends) / len(ends), 3), "p10": round(quantile(ends, 0.1), 3),
        "worst": round(ends[0], 3), "minP10": round(quantile(mins, 0.1), 3), "minWorst": round(mins[0], 3),
    })

as_of = px[-1][0]
as_of_iso = f"{as_of[:4]}-{as_of[4:6]}-{as_of[6:]}"
first = px[0][0]
today = datetime.date.today().isoformat()
meta = {
    "title": "목돈 나눠 넣기 방식별 과거 결과",
    "asOf": as_of_iso,
    "generated": today,
    "script": "scripts/research/build_split_plans.py",
    "sample": f"KODEX 200 {first[:4]}-{first[4:6]}~{as_of_iso[:7]} 일봉(분배금 반영 수정주가), 시작일 {starts:,}가지, 시작 후 6개월 시점",
    "caveat": "시작일이 겹쳐 독립 표본이 아님, 한국 지수 하나의 결과, 미투입 현금은 수익 0%로 계산, "
              "고점 대비 -25% 이하에서 시작한 사례는 6번의 하락 구간뿐이라 따로 결론 내지 않음",
}
body = (
    "// 자동 생성 — scripts/research/build_split_plans.py. 직접 고치지 말고 스크립트를 다시 돌린다.\n"
    "export type SplitPlanStat = {\n"
    "  id: string; label: string; weights: number[]\n"
    "  /** 시작 6개월 뒤 평가(원금=1): 평균·하위10%·최악 */\n"
    "  avg: number; p10: number; worst: number\n"
    "  /** 6개월 동안 도중 최저 평가(원금=1): 하위10%·최악 */\n"
    "  minP10: number; minWorst: number\n"
    "}\n\n"
    f"export const SPLIT_PLAN_META = {json.dumps(meta, ensure_ascii=False, indent=2)}\n\n"
    f"export const SPLIT_PLAN_STATS: SplitPlanStat[] = {json.dumps(plans, ensure_ascii=False, indent=2)}\n"
)
open(OUT, "w", encoding="utf-8", newline="\n").write(body)
print(OUT, starts, "시작일", as_of_iso)
