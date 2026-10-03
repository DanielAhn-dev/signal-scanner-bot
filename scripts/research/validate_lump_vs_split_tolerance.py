# -*- coding: utf-8 -*-
"""
일시금 vs 분할 '후회 보험' 비교 + 감내 낙폭에서 거꾸로 정하는 주식 비중 (2026-10-03).

질문 1: 목돈을 한 번에 넣는 게 불안한 사람에게 분할(3·6·12개월)은 돈을 더 벌게 해 주나, 아니면 불안만 줄여 주나?
        → 평균 수익 차이(분할의 비용)와 '넣은 돈이 첫 해에 얼마까지 줄어 보였는가'(후회 크기)를 같이 본다.
질문 2: "내 돈이 일시적으로 -X%까지는 버틴다"고 할 때 주식 비중은 어디까지인가?
        → 시작 후 5년 안 최대 낙폭 분포(중앙값·나쁜 10%·최악)를 주식 비중별로 본다.

데이터(두 시장으로 교차):
  US : Shiller 월별 S&P500(가격 + 배당/12) 1926~2023 명목 총수익, 채권은 GS10 합성 10년채(validate_long_run.py와 같은 방식)
  KR : 코스피 가격지수 1996~ (.research-cache/kospi.json, 배당 제외 — 상대 비교용), 안전자산은 연 3% 현금 가정
미투입 현금은 연 3% 가정(validate_index_timing.py와 동일). 비용·세금 없음. 월 단위, 시작 후 60개월을 본다.
표본은 겹치는 창이라 독립 표본은 훨씬 적고, KR은 표본이 짧아 참고용이다.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_long_run import R, bond_returns  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CASH_M = 1.03 ** (1 / 12) - 1
H = 60  # 시작 후 관찰 개월
PLANS = [("일시금", 1), ("3개월 분할", 3), ("6개월 분할", 6), ("12개월 분할", 12)]
WEIGHTS = [0, 20, 40, 60, 80, 100]


def us_nominal(start="192601"):
    import xlrd
    sh = xlrd.open_workbook(R + "longrun/ie_data.xls").sheet_by_name("Data")
    rows = {}
    for r in range(8, sh.nrows):
        v = sh.cell_value(r, 0)
        if not isinstance(v, float):
            continue
        y, m = int(v), int(round((v - int(v)) * 100))
        if not 1 <= m <= 12:
            continue
        vals = [sh.cell_value(r, c) for c in (1, 2, 6)]
        if all(isinstance(x, float) for x in vals):
            rows[f"{y}{m:02d}"] = dict(p=vals[0], d=vals[1], gs10=vals[2])
    months = sorted(m for m in rows if m >= start)
    b10 = bond_returns({m: rows[m]["gs10"] for m in months}, months, 10)
    stock = np.array([rows[months[i]]["p"] / rows[months[i - 1]]["p"] - 1 + rows[months[i]]["d"] / 12 / rows[months[i - 1]]["p"]
                      for i in range(1, len(months))])
    bond = np.array([b10[m] for m in months[1:]])
    return months[1:], stock, bond


def kr_nominal():
    rows = json.load(open(R + "kospi.json", encoding="utf-8"))
    rows.sort(key=lambda r: r[0])
    me = {}
    for d, c in rows:
        me[d[:6]] = float(c)
    months = sorted(me)
    stock = np.array([me[months[i]] / me[months[i - 1]] - 1 for i in range(1, len(months))])
    bond = np.full(len(stock), CASH_M)
    return months[1:], stock, bond


def run_plan(stock, s, k):
    """시작월 s에 목돈 1을 k개월에 나눠 100% 주식으로 투입. 미투입은 현금. 반환: 60개월 후 배율, 투입 대비 최저 평가(비율), 12개월 후 평가(비율)"""
    cash, shares_val = 1.0, 0.0  # shares_val = 주식 평가액
    worst = 1.0
    v12 = None
    for t in range(H):
        # 월초 투입
        if t < k:
            amt = 1.0 / k
            cash -= amt
            shares_val += amt
        contributed = min(t + 1, k) / k
        # 월중 수익
        shares_val *= 1 + stock[s + t]
        cash *= 1 + CASH_M
        total = cash + shares_val
        # 투입한 돈 대비 평가: 현금은 아직 안 넣은 돈이므로 투입 원금 + 미투입 현금 모두 기준에 포함해 총자산/1.0 로 본다
        if t < 12:
            worst = min(worst, total)
        if t == 11:
            v12 = total
    return cash + shares_val, worst, v12


def part1(name, stock):
    n = len(stock) - H + 1
    print(f"\n=== 질문 1: 일시금 vs 분할 — {name} (시작월 {n}개, 100% 주식, 시작 후 60개월) ===")
    res = {k: [] for _, k in PLANS}
    for s in range(n):
        for _, k in PLANS:
            res[k].append(run_plan(stock, s, k))
    arr = {k: np.array(v) for k, v in res.items()}
    print(f"{'방식':12s} {'5년후 중앙값':>12s} {'하위10%':>9s} {'최악':>7s} {'일시금보다 나음':>14s} {'첫해 최저 평가 중앙':>18s} {'하위10%':>8s} {'최악':>7s} {'1년후 원금미만':>13s}")
    for label, k in PLANS:
        a = arr[k]
        beat = np.mean(a[:, 0] > arr[1][:, 0]) * 100 if k != 1 else float('nan')
        # 첫 12개월 안의 최저 평가는 전체 60개월 최저와 다를 수 있어 별도 계산
        print(f"{label:12s} {np.median(a[:, 0]):12.2f} {np.percentile(a[:, 0], 10):9.2f} {a[:, 0].min():7.2f} "
              + (f"{beat:13.0f}%" if k != 1 else f"{'-':>14s}")
              + f" {np.median(a[:, 1]):18.2f} {np.percentile(a[:, 1], 10):8.2f} {a[:, 1].min():7.2f} {np.mean(a[:, 2] < 1) * 100:12.0f}%")
    avg_gap = {k: np.mean(arr[k][:, 0] / arr[1][:, 0] - 1) * 100 for _, k in PLANS if k != 1}
    print("일시금 대비 5년 후 평균 격차(%):", ", ".join(f"{label} {avg_gap[k]:+.2f}" for label, k in PLANS if k != 1))
    # 일시금이 크게 불리했던 시작(상위 10% 나쁜 시작)에서 분할이 얼마나 막아 줬나
    worst_idx = np.argsort(arr[1][:, 0])[: max(1, n // 10)]
    print("일시금 결과가 가장 나빴던 10% 시작에서 5년 후 중앙값:", ", ".join(f"{label} {np.median(arr[k][worst_idx, 0]):.2f}" for label, k in PLANS))


def part2(name, stock, bond):
    n = len(stock) - H + 1
    print(f"\n=== 질문 2: 주식 비중별 시작 후 5년 안 최대 낙폭 — {name} (일시금, 월 리밸런싱) ===")
    print(f"{'주식 비중':>8s} {'낙폭 중앙값':>10s} {'나쁜 10%':>9s} {'최악':>7s} {'5년 후 중앙값':>12s} {'5년 후 하위10%':>13s}")
    out = {}
    for w in WEIGHTS:
        r = w / 100 * stock + (1 - w / 100) * bond
        mdds, ends = [], []
        for s in range(n):
            path = np.cumprod(1 + r[s:s + H])
            peak = np.maximum.accumulate(np.concatenate(([1.0], path)))[1:]
            mdds.append((path / peak - 1).min() * 100)
            ends.append(path[-1])
        mdds, ends = np.array(mdds), np.array(ends)
        out[w] = (np.median(mdds), np.percentile(mdds, 10), mdds.min())
        print(f"{w:7d}% {np.median(mdds):10.1f} {np.percentile(mdds, 10):9.1f} {mdds.min():7.1f} {np.median(ends):12.2f} {np.percentile(ends, 10):13.2f}")
    print("감내 낙폭별로 '나쁜 10%'(열 중 한 번은 이 정도까지) 안에 드는 가장 높은 주식 비중 / 역대 최악까지 막는 비중:")
    for tol in (10, 15, 20, 30, 40):
        bad = [w for w in WEIGHTS if out[w][1] >= -tol]
        worst = [w for w in WEIGHTS if out[w][2] >= -tol]
        print(f"  -{tol}%까지 버틴다: 나쁜10% 기준 {max(bad) if bad else '0 미만(채권만으로도 부족)'}% / 최악 기준 {max(worst) if worst else '해당 없음'}")


def main():
    ms, st, bd = us_nominal()
    print(f"US {ms[0]}~{ms[-1]} ({len(ms)}개월)")
    part1("미국 S&P500 1926~2023", st)
    part2("미국 S&P500+10년채 1926~2023", st, bd)
    kms, kst, kbd = kr_nominal()
    print(f"\nKR {kms[0]}~{kms[-1]} ({len(kms)}개월)")
    part1("코스피 1996~ (가격지수)", kst)
    part2("코스피+현금 1996~", kst, kbd)


if __name__ == "__main__":
    main()
