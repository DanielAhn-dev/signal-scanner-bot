# -*- coding: utf-8 -*-
"""
H27 20% 감액 가드레일 표본 밖 확인 (2026-10-07). H20(validate_withdrawal_guardrail.py)에서 20% 감액이 미국 1926~2023 4개 시대 중 3개에서 +15%를 넘었으나
결과를 본 뒤의 변형이라 표본 밖에서만 인정하기로 했다.
규칙: 자산이 시작의 75% 아래면 인출 20% 감액, 90% 위로 회복하면 복원. 60/40 실질, 연 1회 비중 복원, 월 인출.
사전 판정 기준(결과 보기 전 고정, 둘 다 통과해야 안내 채택):
 ① 미국 1871~1925 시작 30년 창을 시작 시기 기준 4개 시대로 나눠, 30년 고갈 10% 이하 최대 시작 인출률이 고정 대비 +15% 이상인 시대가 3개 이상.
 ② 한국(코스피200 ETF 수정주가 + CD91 현금성, 물가 연 2.5% 가정) 20년 창에서 같은 방식의 최대 시작 인출률이 고정보다 높음(방향 동일).
한계: 1871~1925 Shiller는 월평균 가격·합성 채권이라 거칠다. 한국은 24년 표본이라 20년 창이 거의 겹친다(참고 수준, 기준 ②는 방향만).
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_retirement_withdrawal import us_shiller, kr_series  # noqa: E402
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def fails(rs, rb, w, rate, months, cut_pct, trig=0.75, restore=0.90):
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


def max_rate(rs, rb, starts, months, cut_pct, w=0.6, ceiling=0.10):
    best = None
    r = 2.0
    while r <= 10.0 + 1e-9:
        f = np.mean([fails(rs[s:s + months], rb[s:s + months], w, r, months, cut_pct) for s in starts])
        if f <= ceiling:
            best = r
        r = round(r + 0.1, 1)
    return best


def show(name, fx, gd, n):
    rel = (gd / fx - 1) * 100 if fx and gd else float("nan")
    print(f"{name:12s} {n:>4d} {fx:>8.1f}% {gd:>11.1f}% {rel:>8.1f}%")
    return rel


print("### ① 미국 1871~1925 시작, 30년")
months_idx, rs, rb = us_shiller("187101")
H = 360
n = len(rs) - H + 1
eras = {"1871~84": ("187101", "188412"), "1885~98": ("188501", "189812"), "1899~1912": ("189901", "191212"), "1913~25": ("191301", "192512")}
print(f"Shiller 월 {months_idx[0]}~{months_idx[-1]}, 30년 창 {n}개")
print(f"{'시대':12s} {'창':>4s} {'고정 최대':>9s} {'20% 감액':>11s} {'상대 증가':>9s}")
hits = 0
for name, (a, b) in eras.items():
    st = [i for i in range(n) if a <= months_idx[i] <= b]
    fx = max_rate(rs, rb, st, H, 0.0)
    gd = max_rate(rs, rb, st, H, 0.20)
    hits += show(name, fx, gd, len(st)) >= 15
st = [i for i in range(n) if months_idx[i] <= "192512"]
show("1871~1925", max_rate(rs, rb, st, H, 0.0), max_rate(rs, rb, st, H, 0.20), len(st))
print(f"기준 ①: +15% 이상 시대 {hits}/4 (3개 이상이면 통과)")

print()
print("### ② 한국 코스피200 ETF + CD91, 20년")
mk, ks, kb = kr_series(2.5)
HK = 240
nk = len(ks) - HK + 1
st = list(range(nk))
fx = max_rate(ks, kb, st, HK, 0.0)
gd = max_rate(ks, kb, st, HK, 0.20)
print(f"한국 월 {mk[0]}~{mk[-1]}, 20년 창 {nk}개")
print(f"{'':12s} {'창':>4s} {'고정 최대':>9s} {'20% 감액':>11s} {'상대 증가':>9s}")
show("한국 20년", fx, gd, nk)
print(f"기준 ②: 가드레일 > 고정 → {'통과' if gd and fx and gd > fx else '미통과'}")
# 참고: 15년 창과 시작 연도 분할
HK2 = 180
nk2 = len(ks) - HK2 + 1
fx2 = max_rate(ks, kb, list(range(nk2)), HK2, 0.0)
gd2 = max_rate(ks, kb, list(range(nk2)), HK2, 0.20)
show("한국 15년(참고)", fx2, gd2, nk2)
