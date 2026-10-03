# -*- coding: utf-8 -*-
"""
강건성 점검 — 앞선 인출·필요 월 적립 결과가 시대와 표본 방식에 얼마나 흔들리는가 (2026-10-03).

질문: (1) 1926~2023 전체를 합친 '안전 인출률 4%'가 시작 시대(대공황기/전후 호황/1970년대 이후)별로 다른가?
      (2) 겹치는 창이 아니라 10년 블록 부트스트랩(1926~2023의 10년 조각을 무작위로 이어 붙임)으로 봐도 같은가?
      (3) 필요 월 적립액(20년, 3억)이 시작 시대에 따라 얼마나 달라지나?
방법: validate_retirement_withdrawal의 simulate를 그대로 사용(60/40·100% 주식, 비례 인출, 연 리밸런싱). 부트스트랩은 주식·채권 월 수익률 쌍을 같은 달로 묶어 뽑는다.
주의: 시대별 표본은 서로 겹치지 않는 시작월 묶음이지만 창 자체는 겹친다. 부트스트랩은 블록 안의 상관은 살리고 블록 사이는 독립으로 본다(장기 평균회귀가 있으면 과소평가).
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_retirement_withdrawal import simulate, us_shiller  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

RATES = [3.0, 3.5, 4.0, 4.5, 5.0, 6.0]
ERAS = [("1926~1945", "192601", "194512"), ("1946~1965", "194601", "196512"), ("1966~1985", "196601", "198512"), ("1986~", "198601", "999912")]


def fail_rate(rs, rb, w, months, rate, idx):
    f = 0
    for s in idx:
        dep, *_ = simulate(rs[s:s + months], rb[s:s + months], w, rate, months, "prop")
        f += dep is not None
    return f / len(idx) * 100


def req_monthly(rs, years, target, idx):
    """월초 1원씩 넣었을 때 계수 → 필요 월 적립액(원 단위 상대값: target=1.0 기준)"""
    n = years * 12
    out = []
    for s in idx:
        f = 0.0
        for t in range(n):
            f = (f + 1) * (1 + rs[s + t])
        out.append(target / f)
    return np.array(out)


def main():
    ms, rs, rb = us_shiller("192601")
    n_all = len(ms)
    print(f"미국 {ms[0]}~{ms[-1]} ({n_all}개월), 달러 실질")

    for years in (25, 30):
        months = years * 12
        print(f"\n=== (1) 시작 시대별 인출 실패율(%) — {years}년 버티기 ===")
        for w, label in ((0.6, "주식60/채권40"), (1.0, "주식100")):
            print(f"[{label}] 연 인출률:" + "".join(f"{r:>7.1f}%" for r in RATES))
            for name, a, b in [("전체", "192601", "999912")] + ERAS:
                idx = [i for i, m in enumerate(ms) if a <= m <= b and i + months <= n_all]
                if len(idx) < 12:
                    continue
                print(f"  {name:10s}(시작 {len(idx):4d}개월)" + "".join(f"{fail_rate(rs, rb, w, months, r, idx):>8.0f}" for r in RATES))

    # (2) 10년 블록 부트스트랩
    rng = np.random.default_rng(20261003)
    block = 120
    nb = len(rs) - block
    sims = 600
    print(f"\n=== (2) 10년 블록 부트스트랩 {sims}경로 — 인출 실패율(%) ===")
    for years in (25, 30):
        months = years * 12
        for w, label in ((0.6, "60/40"), (1.0, "주식100")):
            line = f"{years}년 {label:8s}:"
            paths = []
            for _ in range(sims):
                rsp, rbp = [], []
                while len(rsp) < months:
                    s = int(rng.integers(0, nb))
                    rsp.extend(rs[s:s + block])
                    rbp.extend(rb[s:s + block])
                paths.append((np.array(rsp[:months]), np.array(rbp[:months])))
            for r in RATES:
                f = sum(simulate(p[0], p[1], w, r, months, "prop")[0] is not None for p in paths)
                line += f"{r:>5.1f}%→{f / sims * 100:>3.0f}"
            print(line)

    # (3) 필요 월 적립(20년, 3억) 시대별
    years = 20
    months = years * 12
    print("\n=== (3) 3억·20년 필요 월 적립액(만원, 주식 100%) — 시작 시대별 ===")
    print(f"{'시대':12s}{'보통':>8s}{'8/10':>8s}{'9/10':>8s}{'최악':>8s}")
    for name, a, b in [("전체", "192601", "999912")] + ERAS:
        idx = [i for i, m in enumerate(ms) if a <= m <= b and i + months <= n_all]
        if len(idx) < 12:
            continue
        need = req_monthly(rs, years, 30000.0, idx)
        q = lambda p: np.quantile(need, p)
        print(f"{name:12s}{q(.5):>8.0f}{q(.8):>8.0f}{q(.9):>8.0f}{need.max():>8.0f}")


if __name__ == "__main__":
    main()
