# -*- coding: utf-8 -*-
"""
월 적립 + 익절/리밸런싱 검증 (2026-10-01). 코스피 1996~ 일봉, 현금 연3%, 매월 1 적립 10년.
  보유    : 전액 지수에 계속 투입
  리밸80:20 : 매월 80:20(지수:현금)으로 적립 + 연 1회 80:20으로 맞춤(오른 만큼 팔아 현금으로)
  리밸60:40 : 같은 방식 60:40
  익절     : 평가수익률(평가금/총납입-1)이 +50%를 넘으면 초과분의 30%를 현금으로 빼고, 지수는 월 적립으로만 다시 채움
지표: 총납입 대비 10년 후 배율(중앙값·하위10%·최악), 보유 중 최대 평가손실률(납입 대비, 1년 이후), 일부 시작점에서 마이너스였던 비율.
"""
import sys
import numpy as np
import validate_index_timing as t

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
c, MF, RC = t.c, t.MF, t.RC
first = set(MF)


def run(s, e, mode):
    idx_val, cash, paid = 0.0, 0.0, 0.0
    worst = 0.0
    for i in range(s, e + 1):
        if i > s:
            idx_val *= c[i] / c[i - 1]
            cash *= 1 + RC
        if i in first:
            paid += 1.0
            if mode == "hold":
                idx_val += 1.0
            elif mode.startswith("rebal"):
                w = 0.8 if mode == "rebal80" else 0.6
                idx_val += w; cash += 1 - w
            else:
                idx_val += 1.0
        if mode.startswith("rebal") and (i - s) % 250 == 0 and i > s:
            w = 0.8 if mode == "rebal80" else 0.6
            tot = idx_val + cash; idx_val, cash = tot * w, tot * (1 - w)
        if mode == "trim" and paid > 0:
            tot = idx_val + cash
            if tot / paid - 1 > 0.5 and i in first:
                gain = idx_val - paid  # 지수 평가이익
                move = max(0.0, 0.3 * (tot - 1.5 * paid))
                move = min(move, idx_val)
                idx_val -= move; cash += move
        if i - s > 250 and paid > 0:
            worst = min(worst, (idx_val + cash) / paid - 1)
    return (idx_val + cash) / paid, worst


modes = ["hold", "rebal80", "rebal60", "trim"]
labels = {"hold": "계속 보유(전액 지수)", "rebal80": "리밸런싱 80:20", "rebal60": "리밸런싱 60:40", "trim": "익절(+50% 넘으면 초과분 30%)"}
for lo, hi, name in [(0, 99999999, "전체"), (0, 20081231, "1997~2008 시작"), (20090101, 99999999, "2009 이후 시작")]:
    starts = [m for m in MF if m >= 250 and m + 2500 < t.N and lo <= int(t.dates[m]) <= hi]
    print(f"\n[{name}] 시작점 {len(starts)}개 — 10년 적립")
    print(f"{'방식':28s} {'중앙값':>7s} {'하위10%':>8s} {'최악':>6s} {'최대평가손실 중앙/최악':>22s} {'마이너스 시작점':>12s}")
    for m in modes:
        r = np.array([run(s, s + 2500, m) for s in starts])
        fin, w = r[:, 0], r[:, 1]
        print(f"{labels[m]:28s} {np.median(fin):7.3f} {np.percentile(fin,10):8.3f} {fin.min():6.3f} {np.median(w)*100:10.1f}% /{w.min()*100:6.1f}% {np.mean(fin<1)*100:11.0f}%")
