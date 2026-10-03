# -*- coding: utf-8 -*-
"""
감내 낙폭 표 보강 (2026-10-03) — 기존 표는 '시작 후 5년 안' 낙폭만 봤다. 오래 들고 있으면 낙폭은 더 깊어진다.
질문: (1) 보유 기간을 5/10/20년으로 늘리면 나쁜 10% 최대 낙폭은 얼마나 깊어지나? (2) 시작 시대별로는?
방법: validate_lump_vs_split_tolerance.us_nominal(Shiller 월평균 가격, 합성 10년채), 일시금, 월 리밸런싱, 명목 기준 고점 대비 낙폭.
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_lump_vs_split_tolerance import us_nominal  # noqa: E402
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

W = [0, 20, 40, 60, 80, 100]
ERAS = [("전체", "192601", "999912"), ("1926~45", "192601", "194512"), ("1946~65", "194601", "196512"), ("1966~85", "196601", "198512"), ("1986~", "198601", "999912")]

def mdd(r, s, h):
    path = np.cumprod(1 + r[s:s + h])
    peak = np.maximum.accumulate(np.concatenate(([1.0], path)))[1:]
    return (path / peak - 1).min() * 100

ms, st, bd = us_nominal()
n = len(st)
print(f"미국 {ms[0]}~{ms[-1]}")
print("\n=== 보유 기간별 나쁜 10% / 최악 최대 낙폭(%) ===")
print(f"{'주식비중':>8s}" + "".join(f"{y:>6d}년 나쁜10%/최악" for y in (5, 10, 20)))
for w in W:
    r = w / 100 * st + (1 - w / 100) * bd
    cells = []
    for y in (5, 10, 20):
        h = y * 12
        v = np.array([mdd(r, s, h) for s in range(n - h + 1)])
        cells.append(f"{np.percentile(v, 10):>9.1f}/{v.min():>6.1f}")
    print(f"{w:7d}%  " + "  ".join(cells))
print("\n=== 시작 시대별 5년 내 나쁜 10% 낙폭(%) ===")
print(f"{'주식비중':>8s}" + "".join(f"{e[0]:>10s}" for e in ERAS))
for w in W:
    r = w / 100 * st + (1 - w / 100) * bd
    cells = []
    for _, a, b in ERAS:
        idx = [i for i, m in enumerate(ms) if a <= m <= b and i + 60 <= n]
        v = np.array([mdd(r, s, 60) for s in idx])
        cells.append(f"{np.percentile(v, 10):>10.1f}")
    print(f"{w:7d}%" + "".join(cells))
