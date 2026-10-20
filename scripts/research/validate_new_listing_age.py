# -*- coding: utf-8 -*-
"""
H60 (V3) 상장 1년이 안 된 종목은 같은 날 상장 1년이 넘은 종목보다 이후 60거래일 수익이 나쁜가 (2026-10-20).

판정 기준은 docs/hypothesis-ledger.md H60 행에 결과 보기 전에 고정했다. 여기서는 그대로 계산만 한다.
데이터: .research-cache/px.pkl (revalidate_rules.py가 만든 네이버 수정주가, 상장폐지 포함, 2014-01~)
        .research-cache/corps.json (DART 고유번호·이름·종목코드, 스팩 판정용)
상장일: 첫 가격일. 2014-01-10 이전에 첫 가격이 있으면 나이를 모르므로 제외.
한계: 이름은 현재(또는 마지막) 이름이라 스팩 합병 뒤 이름이 바뀐 종목은 스팩 기간이 '신규 상장'으로 섞일 수 있다.
      코스닥→코스피 이전 상장은 종목코드가 같아 신규로 잡히지 않는다(의도대로). 우선주는 DART 목록에 없다.
"""
import json
import pickle
import sys

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CACHE = ".research-cache"
px = pickle.load(open(f"{CACHE}/px.pkl", "rb"))
corps = json.load(open(f"{CACHE}/corps.json", encoding="utf-8"))
spac = {c[2] for c in corps if "스팩" in c[1] or "기업인수목적" in c[1]}

HORIZON = 60
BUCKETS = [("3개월 안(6~60일)", 6, 60), ("3~6개월(61~125일)", 61, 125), ("6~12개월(126~250일)", 126, 250)]
YOUNG = (6, 250)
BASE_MIN = 251

# 거래일 달력: 가장 많이 쓰인 날짜 집합
all_dates = sorted({r[0] for v in px.values() for r in v})
date_idx = {d: i for i, d in enumerate(all_dates)}

# 분기말 표본일 (각 분기 마지막 거래일), 2015-03 ~ 2026-06
qends = []
for y in range(2015, 2027):
    for m in ("03", "06", "09", "12"):
        if (y, m) > (2026, "06"):
            continue
        ds = [d for d in all_dates if d.startswith(f"{y}{m}")]
        if ds:
            qends.append(ds[-1])

series = {}
for code, rows in px.items():
    if not rows or code in spac:
        continue
    rows = [r for r in rows if r[4] and r[4] > 0]
    if not rows:
        continue
    first = rows[0][0]
    known_age = first > "20140110"
    dates = [r[0] for r in rows]
    closes = np.array([r[4] for r in rows], float)
    tv = np.array([r[4] * r[5] for r in rows], float)
    series[code] = (known_age, date_idx[first], dates, closes, tv)

recs = []  # (qdate, code, age, excess placeholder, ret, top300 flag)
for q in qends:
    qi = date_idx[q]
    cands = []
    for code, (known, fi, dates, closes, tv) in series.items():
        # 그 날 가격이 있는 종목만
        lo, hi = 0, len(dates)
        import bisect
        k = bisect.bisect_right(dates, q) - 1
        if k < 0 or dates[k] != q:
            continue
        if k < 20:
            avg_tv = tv[max(0, k - 19):k + 1].mean()
        else:
            avg_tv = tv[k - 19:k + 1].mean()
        if avg_tv < 1e9:
            continue
        age = qi - fi  # 거래일 기준 나이(전체 달력 기준)
        if not known and age < BASE_MIN:
            continue
        # 다음 60거래일 수익(그 사이 상장폐지면 마지막 가격)
        target = all_dates[min(qi + HORIZON, len(all_dates) - 1)]
        j = bisect.bisect_right(dates, target) - 1
        if j <= k:
            continue
        ret = closes[j] / closes[k] - 1
        cands.append((code, age, ret, avg_tv))
    if not cands:
        continue
    top = {c[0] for c in sorted(cands, key=lambda x: -x[3])[:300]}
    for code, age, ret, _ in cands:
        recs.append((q, code, age, ret, code in top))

print(f"분기 표본일 {len(qends)}개 ({qends[0]}~{qends[-1]}), 종목·분기 {len(recs):,}건")


def analyze(label, rs):
    print(f"\n== {label} ==")
    by_q = {}
    for q, code, age, ret, _ in rs:
        by_q.setdefault(q, []).append((age, ret))
    rows_out = {}
    for name, a, b in BUCKETS + [("1년 미만 합계(6~250일)", *YOUNG)]:
        ex, n_all, deep_y, deep_b, n_b = [], 0, 0, 0, 0
        per_q = []
        for q, lst in sorted(by_q.items()):
            base = [r for ag, r in lst if ag >= BASE_MIN]
            yng = [r for ag, r in lst if a <= ag <= b]
            if not base or not yng:
                continue
            bm = np.mean(base)
            per_q.append((q, np.mean(yng) - bm, len(yng)))
            n_all += len(yng)
            deep_y += sum(r <= -0.30 for r in yng)
            deep_b += sum(r <= -0.30 for r in base)
            n_b += len(base)
        if not per_q:
            continue
        x = np.array([p[1] for p in per_q])
        t = x.mean() / (x.std(ddof=1) / np.sqrt(len(x))) if len(x) > 2 else float("nan")
        front = np.array([p[1] for p in per_q if p[0] < "20210101"])
        back = np.array([p[1] for p in per_q if p[0] >= "20210101"])
        rows_out[name] = dict(mean=x.mean(), t=t, front=front.mean() if len(front) else float("nan"),
                              back=back.mean() if len(back) else float("nan"), n=n_all, q=len(x),
                              deep_y=deep_y / n_all, deep_b=deep_b / n_b)
        print(f"{name:22s} 분기 {len(x):2d} 건 {n_all:5d} | 초과 평균 {x.mean()*100:+6.2f}%  t {t:+5.2f} | "
              f"앞(15~20) {rows_out[name]['front']*100:+6.2f}% 뒤(21~26) {rows_out[name]['back']*100:+6.2f}% | "
              f"−30% 이하 {deep_y / n_all*100:4.1f}% vs 기준 {deep_b / n_b*100:4.1f}%")
    return rows_out


main = analyze("거래대금 10억 이상 전체", recs)
analyze("거래대금 상위 300 (봇 후보군 근사)", [r for r in recs if r[4]])

y = main.get("1년 미만 합계(6~250일)")
if y:
    c1 = y["front"] < 0 and y["back"] < 0
    c2 = y["t"] < -3
    c3 = y["deep_y"] > y["deep_b"]
    print(f"\n판정(사전 기준): ① 두 구간 모두 음수 {c1} ② t<−3 {c2} ③ −30% 비율 더 높음 {c3} → {'채택' if c1 and c2 and c3 else '기각'}")
