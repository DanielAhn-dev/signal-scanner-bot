# -*- coding: utf-8 -*-
"""
필요 월 적립액 역산 — 20대 후반이 40~50대에 '몇 억'(오늘 가치)에 닿으려면 매달 얼마가 필요한가 (2026-10-03).

질문: 적금 대신 처음부터 투자만 하면 목표에 닿는 데 필요한 월 금액이 얼마나 줄어드나? 운이 나쁜 시작 시점에서도 닿으려면 얼마나 더 넣어야 하나?
방법: 시작월마다 '매달 1(오늘 가치)을 N년 넣었을 때 N년 후 오늘 가치로 얼마'를 구하고, 목표 ÷ (분위수 값) = 필요 월 적립액.
      '10번 중 9번 닿으려면'은 하위 10% 시작월의 값으로 나눈 것(= 시작 시점이 나쁜 쪽 10%에서도 닿는 금액).
가정:
  - 모든 금액은 오늘 가치(물가 반영). 월 적립액은 오늘 가치로 일정(임금 상승에 맞춰 명목은 늘어난다고 본다).
  - 적금(예금)은 실질 연 +0.5%로 고정(명목 3% − 물가 2.5%) — 세전, 이자소득세 15.4%는 반영하지 않아 약간 낙관.
  - 투자: US = Shiller S&P500 총수익 1926~2023 실질. KR = 코스피 가격지수 1996~ + 배당 연 1.8% 근사 − 물가 2.5%(물가·배당 가정이라 참고용, 표본 짧음).
  - 60/40: 주식 60% + (US 합성 10년채 / KR 현금 3%) 40%, 월 리밸런싱.
  - 세금·수수료·환율 없음. 겹치는 창이라 독립 표본은 훨씬 적다.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_long_run import R, bond_returns  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

INFL_M = 1.025 ** (1 / 12) - 1
SAVINGS_REAL_M = (1.03 / 1.025) ** (1 / 12) - 1
TARGETS_EOK = [2, 3, 5]  # 억
HORIZONS = [15, 20, 25]


def us_real():
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
        vals = [sh.cell_value(r, c) for c in (1, 2, 4, 6)]
        if all(isinstance(x, float) for x in vals):
            rows[f"{y}{m:02d}"] = dict(p=vals[0], d=vals[1], cpi=vals[2], gs10=vals[3])
    months = sorted(m for m in rows if m >= "192601")
    b10 = bond_returns({m: rows[m]["gs10"] for m in months}, months, 10)
    rs, rb = [], []
    for i in range(1, len(months)):
        m, p = months[i], months[i - 1]
        stock = rows[m]["p"] / rows[p]["p"] - 1 + rows[m]["d"] / 12 / rows[p]["p"]
        cpi = rows[m]["cpi"] / rows[p]["cpi"] - 1
        rs.append((1 + stock) / (1 + cpi) - 1)
        rb.append((1 + b10[m]) / (1 + cpi) - 1)
    return np.array(rs), np.array(rb)


def kr_real():
    rows = json.load(open(R + "kospi.json", encoding="utf-8"))
    rows.sort(key=lambda r: r[0])
    me = {}
    for d, c in rows:
        me[d[:6]] = float(c)
    months = sorted(me)
    div_m = 1.018 ** (1 / 12) - 1
    cash_m = 1.03 ** (1 / 12) - 1
    rs, rb = [], []
    for i in range(1, len(months)):
        stock = me[months[i]] / me[months[i - 1]] - 1 + div_m
        rs.append((1 + stock) / (1 + INFL_M) - 1)
        rb.append((1 + cash_m) / (1 + INFL_M) - 1)
    return np.array(rs), np.array(rb)


def dca_multiples(r, years):
    """시작월마다: 매달 1(오늘 가치)을 월초에 넣어 N년 뒤 오늘 가치 합계"""
    n = years * 12
    out = []
    for s in range(len(r) - n + 1):
        v = 0.0
        for t in range(n):
            v = (v + 1.0) * (1 + r[s + t])
        out.append(v)
    return np.array(out)


def main():
    savings = {y: ((1 + SAVINGS_REAL_M) ** (y * 12) - 1) / SAVINGS_REAL_M * (1 + SAVINGS_REAL_M) for y in HORIZONS}
    markets = {}
    for name, (rs, rb) in (("US S&P500 1926~2023", us_real()), ("KR 코스피 1996~ (배당 근사)", kr_real())):
        markets[name] = {"주식100%": rs, "60/40": 0.6 * rs + 0.4 * rb}
    print("필요 월 적립액(만원, 오늘 가치). 열: 적금 / 투자 '운 보통'(중앙값 시작) / '10번 중 8번'(하위20%) / '10번 중 9번'(하위10%)")
    for tgt in TARGETS_EOK:
        print(f"\n--- 목표 {tgt}억 (오늘 가치) ---")
        for y in HORIZONS:
            sv = tgt * 10_000 / savings[y]
            print(f"\n[{y}년]  적금만: 월 {sv:.0f}만원")
            for mname, ports in markets.items():
                for pname, r in ports.items():
                    m = dca_multiples(r, y)
                    need = {q: tgt * 10_000 / np.percentile(m, q) for q in (50, 20, 10)}
                    worst = tgt * 10_000 / m.min()
                    print(f"   {mname:26s} {pname:7s}: 보통 {need[50]:5.0f} / 8/10 {need[20]:5.0f} / 9/10 {need[10]:5.0f} / 최악 시작 {worst:5.0f}   (n={len(m)})")


if __name__ == "__main__":
    main()
