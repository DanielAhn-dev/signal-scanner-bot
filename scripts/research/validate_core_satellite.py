# -*- coding: utf-8 -*-
"""C24 코어-위성: KODEX200 + 선호 점수 위성(월 교체). 기준은 hypothesis-ledger C24에 결과 보기 전 고정."""
import sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import validate_composite_portfolio as cps
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
T, dates, EC = cps.T, cps.dates, cps.EC
START = 511


def seg_stats(nav, lo, hi):
    ii = [i for i in range(START, T) if lo <= dates[i] <= hi and np.isfinite(nav[i])]
    a, b = ii[0], ii[-1]
    yrs = (b - a) / 252
    seg = nav[a:b + 1]
    return (nav[b] / nav[a]) ** (1 / yrs) - 1, (seg / np.maximum.accumulate(seg) - 1).min()


def blend(core, sat, w, step=21):
    nav = np.full(T, np.nan); nav[START] = 1.0
    a, b = 1 - w, w
    for t in range(START + 1, T):
        rc = core[t] / core[t - 1]; rs = sat[t] / sat[t - 1]
        a *= rc; b *= rs
        tot = a + b
        if (t - START) % step == 0:
            a, b = tot * (1 - w), tot * w
        nav[t] = tot
    return nav


def main():
    core = np.array([EC[i] / EC[START] for i in range(T)])
    for mode, n in (("comp", 20), ("lv52", 20), ("comp", 10)):
        sat = cps.simulate(mode, n, 21)
        sat[:START] = np.nan
        print(f"--- 위성: {mode} 상위{n} 월 교체 (연수익/최대낙폭) ---")
        for w in (0.0, 0.1, 0.2, 0.3, 1.0):
            nav = core if w == 0 else (sat if w == 1 else blend(core, sat, w))
            r = []
            for lo, hi in (("20160101", "20211231"), ("20220101", "29991231")):
                c, m = seg_stats(nav, lo, hi)
                r.append(f"{c*100:+6.1f}%/{m*100:5.0f}%")
            lab = "KODEX200 단독" if w == 0 else ("위성 단독" if w == 1 else f"위성 {int(w*100)}%")
            print(f"  {lab:<14} 안 {r[0]} | 밖 {r[1]}")

if __name__ == "__main__":
    main()
