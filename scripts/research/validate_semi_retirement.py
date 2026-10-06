# -*- coding: utf-8 -*-
"""
반퇴 계산 — 월 300만원 = 투자 인출 + 일·부업 소득. 지금 자산·월 저축으로 몇 년 뒤 가능한가 (2026-10-06).

방법: 미국 1926~2023 실질 월수익(Shiller, 배당 포함, 물가 반영)의 모든 시작월에 대해
  ① Y년 동안 지금 자산 A에 매달 S를 넣고 ② 그 뒤 30년 동안 매달 (300만 − P)를 꺼낸다.
  30년 안에 바닥나지 않는 시작월 비율이 90% 이상(10번 중 9번)·50%(보통 운)가 되는 최소 Y를 찾는다.
모든 금액은 오늘 가치. 세금·수수료·건보료 없음(인출 세후 효과는 retirementCash.ts 참고).
한국은 표본(1996~)이 짧아 쓰지 않는다. 주식 60%/채권 40%, 주식 80%/20% 두 가지.

실행: python scripts/research/validate_semi_retirement.py
"""
import os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_required_saving import us_real  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

NEED = 300  # 만원/월
WITHDRAW_YEARS = 30
ASSETS = [1e4, 2e4, 3e4]  # 만원 (1·2·3억)
SAVINGS = [100, 200]
SIDE = [0, 100, 150, 200]
MAX_Y = 30


def ok_rate(r, A, S, W, Y):
    acc, dec = Y * 12, WITHDRAW_YEARS * 12
    n = len(r) - acc - dec
    if n <= 0:
        return np.nan
    starts = np.arange(n)
    bal = np.full(n, A, float)
    for m in range(acc):
        bal = (bal + S) * (1 + r[starts + m])
    alive = np.ones(n, bool)
    for m in range(dec):
        bal = (bal - W) * (1 + r[starts + acc + m])
        alive &= bal > 0
        bal = np.where(alive, bal, 0)
    return alive.mean()


def years_needed(r, A, S, W, target):
    if W <= 0:
        return 0
    for Y in range(0, MAX_Y + 1):
        p = ok_rate(r, A, S, W, Y)
        if np.isnan(p):
            return None
        if p >= target:
            return Y
    return None


def main():
    rs, rb = us_real()
    for w_s, label in ((0.6, "주식 60/채권 40"), (0.8, "주식 80/채권 20")):
        r = w_s * rs + (1 - w_s) * rb
        print(f"\n[{label}] 월 {NEED}만원 = 인출 + 일·부업 소득 P, 인출 30년. 값 = 준비 기간(년): 10번 중 9번 / 보통 운")
        print(f"  {'지금 자산':<8}{'월 저축':<8}" + "".join(f"{'P=' + str(p) + '만':>16}" for p in SIDE))
        for A in ASSETS:
            for S in SAVINGS:
                cells = []
                for P in SIDE:
                    W = NEED - P
                    y90 = years_needed(r, A, S, W, 0.9)
                    y50 = years_needed(r, A, S, W, 0.5)
                    f = lambda y: f"{y}" if y is not None else f">{MAX_Y}"
                    cells.append(f"{f(y90)} / {f(y50)}")
                print(f"  {int(A/1e4)}억{'':<6}{S}만{'':<4}" + "".join(f"{c:>16}" for c in cells), flush=True)


if __name__ == "__main__":
    main()
