# -*- coding: utf-8 -*-
"""
올웨더·자산배분의 장기(1972~2023) 검증 — 1970년대 인플레이션과 1980년대 금리 급등 구간 포함 (2026-10-02).

데이터 (모두 달러 기준, 원화 환산 없음):
  - 주식: 야후 ^GSPC 월말 종가(가격) + Shiller 배당(연율/12)을 월초 가격 대비로 더한 총수익
  - 채권: Shiller GS10(10년 국채금리, 월 평균)으로 만든 합성 총수익. 직전 달 금리를 쿠폰으로 하는 평가금리 채권이 금리 변동으로 한 달 뒤 가격이 어떻게 변하는지 + 쿠폰.
         10년채는 만기 10년, '장기채(20년)'는 같은 금리 변동에 만기 20년 가격식을 적용한 근사(20년 금리 데이터가 없어 만기 프리미엄은 반영 못함)
  - 금: datasets/gold-prices 월별 USD/oz
  - 물가: Shiller CPI
한계: 원자재(올웨더의 7.5%)는 이 기간 투자 가능한 지수 데이터가 없어 금으로 합쳤다. 현금(단기금리) 데이터가 없어 영구포트폴리오는 못 돌린다.
      Shiller 금리·가격은 월 평균이라 변동성이 약간 작게 나온다. Shiller 공개 파일은 2023-09까지다.
"""
import csv
import json
import sys

import numpy as np
import xlrd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
R = ".research-cache/"


def load_shiller():
    sh = xlrd.open_workbook(R + "longrun/ie_data.xls").sheet_by_name("Data")
    out = {}
    for r in range(8, sh.nrows):
        v = sh.cell_value(r, 0)
        if not isinstance(v, float):
            continue
        y = int(v)
        m = int(round((v - y) * 100))
        if m < 1 or m > 12:
            continue
        def f(c):
            x = sh.cell_value(r, c)
            return float(x) if isinstance(x, float) else None
        out[f"{y}{m:02d}"] = {"cpi": f(4), "gs10": f(6), "div": f(2)}
    return out


def load_gold():
    out = {}
    for row in csv.DictReader(open(R + "longrun/gold_monthly.csv", encoding="utf-8")):
        out[row["Date"].replace("-", "")] = float(row["Price"])
    return out


def load_spx_month_end():
    rows = json.load(open(R + "allweather/us__GSPC.json", encoding="utf-8"))
    by = {}
    for d, adj, close in rows:
        by[d[:6]] = float(close)
    return by


def bond_price(coupon, y, n):
    """반년 복리 평가, 액면 1, 연 쿠폰 coupon, 만기 n년, 금리 y(소수)."""
    if y <= 0:
        return 1.0
    k = 2 * n
    v = (1 + y / 2) ** (-k)
    return coupon / y * (1 - v) + v


def bond_returns(gs10, months, n):
    """직전 달 금리 y0를 쿠폰으로 가진 만기 n년 채권의 한 달 총수익."""
    out = {}
    for i in range(1, len(months)):
        y0, y1 = gs10[months[i - 1]] / 100, gs10[months[i]] / 100
        p = bond_price(y0, y1, n - 1 / 12)
        out[months[i]] = p + y0 / 12 - 1
    return out


def main():
    sh = load_shiller()
    gold = load_gold()
    spx = load_spx_month_end()
    months = sorted(m for m in sh if m in gold and m in spx and sh[m]["gs10"] and sh[m]["cpi"] and m >= "197112")
    gs10 = {m: sh[m]["gs10"] for m in months}
    b10 = bond_returns(gs10, months, 10)
    b20 = bond_returns(gs10, months, 20)
    idx = {m: i for i, m in enumerate(months)}
    ret = {k: {} for k in ("SPX", "B10", "B20", "GLD", "CPI")}
    for i in range(1, len(months)):
        m, p = months[i], months[i - 1]
        d = (sh[m]["div"] or 0) / 12
        ret["SPX"][m] = spx[m] / spx[p] - 1 + d / spx[p]
        ret["B10"][m], ret["B20"][m] = b10[m], b20[m]
        ret["GLD"][m] = gold[m] / gold[p] - 1
        ret["CPI"][m] = sh[m]["cpi"] / sh[p]["cpi"] - 1
    ms = months[1:]
    A = {k: np.array([ret[k][m] for m in ms]) for k in ret}
    cpi = A["CPI"]

    portfolios = {
        "S&P500 100%": {"SPX": 1},
        "60/40 (주식·10년채)": {"SPX": .6, "B10": .4},
        "올웨더 근사(주30·20년채40·10년채15·금15)": {"SPX": .3, "B20": .4, "B10": .15, "GLD": .15},
        "주식·20년채·금 균등": {"SPX": 1 / 3, "B20": 1 / 3, "GLD": 1 / 3},
        "주60·20년채20·금20": {"SPX": .6, "B20": .2, "GLD": .2},
        "금 100%": {"GLD": 1},
        "10년채 100%": {"B10": 1},
    }

    def run(w):
        keys = list(w)
        out = np.zeros(len(ms))
        cur = np.array([w[k] for k in keys], float)
        tgt = cur.copy()
        for i in range(len(ms)):
            g = cur * (1 + np.array([A[k][i] for k in keys]))
            out[i] = g.sum() - 1
            cur = g / g.sum()
            cur = tgt.copy()  # 월 리밸런싱
        return out

    def stats(d, c):
        eq = np.cumprod(1 + d)
        real = np.cumprod((1 + d) / (1 + c))
        y = len(d) / 12
        return ((eq[-1] ** (1 / y) - 1) * 100, (real[-1] ** (1 / y) - 1) * 100,
                (eq / np.maximum.accumulate(eq) - 1).min() * 100, (real / np.maximum.accumulate(real) - 1).min() * 100)

    def window(a, b):
        i0 = next(i for i, m in enumerate(ms) if m >= a)
        i1 = max(i for i, m in enumerate(ms) if m <= b)
        return i0, i1 + 1

    periods = [("전체", ms[0], ms[-1]), ("1972~1981 인플레", "197201", "198112"), ("1982~1999", "198201", "199912"),
               ("2000~2009", "200001", "200912"), ("2010~2023", "201001", "202309")]
    print(f"기간 {ms[0]}~{ms[-1]} ({len(ms)}개월), 달러 기준·월 리밸런싱·비용 없음")
    print(f"{'구성':34s}" + "".join(f"| {n[:10]:>10s} 명목/실질 " for n, _, _ in periods))
    series = {n: run(w) for n, w in portfolios.items()}
    for n, d in series.items():
        line = f"{n:34s}"
        for pn, a, b in periods:
            i0, i1 = window(a, b)
            s = stats(d[i0:i1], cpi[i0:i1])
            line += f"| {s[0]:5.1f}/{s[1]:5.1f}       "
        print(line)
    print("\n실질 최대 낙폭(%) / 실질 기준 최악 5년 연환산(%) / 5년 실질 마이너스였던 비율(%)")
    for n, d in series.items():
        real = np.cumprod((1 + d) / (1 + cpi))
        mdd = (real / np.maximum.accumulate(real) - 1).min() * 100
        r5 = np.array([(real[i + 60] / real[i]) ** (1 / 5) - 1 for i in range(0, len(real) - 60)]) * 100
        print(f"{n:34s} {mdd:7.1f} / {r5.min():6.1f} / {np.mean(r5 < 0) * 100:5.1f}")
    print("\n주요 구간 명목 수익률(%): 1973-1974 / 1980.2~1981.9 금리급등 / 2000~2002 / 2008 / 2022")
    for n, d in series.items():
        out = []
        for a, b in (("197301", "197412"), ("198002", "198109"), ("200001", "200212"), ("200801", "200812"), ("202201", "202212")):
            i0, i1 = window(a, b)
            out.append((np.prod(1 + d[i0:i1]) - 1) * 100)
        print(f"{n:34s} " + " / ".join(f"{x:7.1f}" for x in out))


if __name__ == "__main__":
    main()
