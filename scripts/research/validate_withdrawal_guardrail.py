# -*- coding: utf-8 -*-
"""
H20 인출 가드레일 검증 (2026-10-07).
가설: 자산이 시작의 75% 아래로 내려가면 인출을 10% 줄이고 90% 위로 회복하면 복원하는 규칙이, 고정 인출(물가연동)보다
      같은 고갈 위험(30년 고갈 확률 10% 이하)에서 시작 인출률을 15% 이상 높인다.
사전 판정 기준(결과 보기 전 고정): 시대별 4개 구간(시작 월 기준) 중 3개 이상에서 가드레일의 최대 시작 인출률이 고정보다 +15% 이상(상대).
데이터: Shiller 1926~2023 S&P 총수익 + 합성 10년채, CPI로 실질 환산. 주식 60/채권 40, 연 1회 비중 복원, 30년, 월 인출.
시대: 시작월 1926~1949 / 1950~1969 / 1970~1989 / 1990~(30년 창이 끝나는 2023까지).
변형(참고, 판정 아님): 감액 20%, 트리거 80%.
한계: 겹치는 창이라 독립 표본이 적음, 세금·수수료 없음, 표본 시작월을 시대로 쪼개면 시대당 약 240~290개 창.
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_retirement_withdrawal import us_shiller  # noqa: E402
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def fails(rs, rb, w, rate, months, cut_pct, trig, restore):
    S, B = w, 1 - w
    cut = False
    base = rate / 100 / 12
    for i in range(months):
        total = S + B
        if cut_pct > 0:
            if not cut and total < trig:
                cut = True
            elif cut and total > restore:
                cut = False
        need = base * (1 - cut_pct) if cut else base
        if need >= total:
            return True
        share = S / total
        S -= need * share
        B -= need * (1 - share)
        S *= 1 + rs[i]
        B *= 1 + rb[i]
        if (i + 1) % 12 == 0:
            t = S + B
            S, B = w * t, (1 - w) * t
    return False


def max_rate(rs, rb, starts, w, months, cut_pct, trig, restore, ceiling=0.10):
    best = None
    r = 2.0
    while r <= 9.0 + 1e-9:
        f = np.mean([fails(rs[s:s + months], rb[s:s + months], w, r, months, cut_pct, trig, restore) for s in starts])
        if f <= ceiling:
            best = r
        r = round(r + 0.1, 1)
    return best


months_idx, rs, rb = us_shiller("192601")
H = 360
n = len(rs) - H + 1
eras = {"1926~49": ("192601", "194912"), "1950~69": ("195001", "196912"), "1970~89": ("197001", "198912"), "1990~": ("199001", "299912")}
print(f"Shiller 월 {months_idx[0]}~{months_idx[-1]}, 30년 창 {n}개")
for label, cut_pct, trig, restore in (("기준: 10% 감액·75%/90%", 0.10, 0.75, 0.90), ("변형: 20% 감액·75%/90%", 0.20, 0.75, 0.90), ("변형: 10% 감액·80%/95%", 0.10, 0.80, 0.95)):
    print(f"\n### {label}")
    print(f"{'시대':10s} {'창':>4s} {'고정 최대':>9s} {'가드레일 최대':>12s} {'상대 증가':>9s}")
    hits = 0
    for name, (a, b) in eras.items():
        st = [i for i in range(n) if a <= months_idx[i] <= b]
        if not st:
            continue
        fx = max_rate(rs, rb, st, 0.6, H, 0.0, 0, 0)
        gd = max_rate(rs, rb, st, 0.6, H, cut_pct, trig, restore)
        rel = (gd / fx - 1) * 100 if fx and gd else float('nan')
        hits += rel >= 15
        print(f"{name:10s} {len(st):>4d} {fx:>8.1f}% {gd:>11.1f}% {rel:>8.1f}%")
    st = list(range(n))
    fx = max_rate(rs, rb, st, 0.6, H, 0.0, 0, 0)
    gd = max_rate(rs, rb, st, 0.6, H, cut_pct, trig, restore)
    print(f"{'전체':10s} {len(st):>4d} {fx:>8.1f}% {gd:>11.1f}% {(gd/fx-1)*100:>8.1f}%   (+15% 이상 시대 {hits}/4)")

# 감액 빈도: 20% 감액 변형을 전체 최대 시작 인출률(5.0%)로 쓸 때 30년 중 감액 개월 비율
def cut_share(rs, rb, w, rate, months, cut_pct, trig, restore):
    S, B = w, 1 - w
    cut = False; cm = 0
    base = rate / 100 / 12
    for i in range(months):
        total = S + B
        if not cut and total < trig: cut = True
        elif cut and total > restore: cut = False
        need = base * (1 - cut_pct) if cut else base
        cm += cut
        if need >= total: return None
        share = S / total
        S -= need * share; B -= need * (1 - share)
        S *= 1 + rs[i]; B *= 1 + rb[i]
        if (i + 1) % 12 == 0:
            t = S + B; S, B = w * t, (1 - w) * t
    return cm / months

vals = [cut_share(rs[s:s+H], rb[s:s+H], 0.6, 5.0, H, 0.20, 0.75, 0.90) for s in range(n)]
ok = np.array([v for v in vals if v is not None])
print(f"\n[감액 빈도: 20% 변형, 시작 인출률 5.0%] 고갈 {sum(v is None for v in vals)/n*100:.1f}%, 감액이 한 번이라도 있었던 창 {(ok>0).mean()*100:.0f}%, 감액 개월 비율 중앙 {np.median(ok)*100:.1f}% 하위 90%분위 {np.percentile(ok,90)*100:.1f}%")
for r_ in (4.5, 5.0):
    v_ = [cut_share(rs[s:s+H], rb[s:s+H], 0.6, r_, H, 0.20, 0.75, 0.90) for s in range(n)]
    o_ = np.array([x for x in v_ if x is not None])
    print(f"시작 {r_}%: 평균 감액 개월 비율 {o_.mean()*100:.1f}%, 중앙 {np.median(o_)*100:.1f}%, 감액 경험 창 {(o_>0).mean()*100:.0f}%")
