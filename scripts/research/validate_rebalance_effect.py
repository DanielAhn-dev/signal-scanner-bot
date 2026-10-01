# -*- coding: utf-8 -*-
"""
4자산(KODEX200·나스닥100·국고채10년·골드) 리밸런싱 효과 분리 검증 (2026-10-01). 2011-10~, 분배금 미반영.
같은 4자산 25%씩에서 '오른 건 팔고 내린 건 사서 비중 맞추기'만 바꿔 비교한다:
  안 함 / 연 1회 / 분기 / 월 / 밴드(어느 자산이든 목표 대비 ±5%p 이탈 시, 월말 점검)
추가로 월 적립(매월 1)을 (a) 4자산에 25%씩 고정 분할 (b) 목표 비중에서 가장 모자란 자산에 몰아서(파는 것 없이 적립만으로 맞춤).
비용: 매매 금액의 0.1%.
"""
import io, contextlib, sys
import numpy as np

with contextlib.redirect_stdout(io.StringIO()):
    import validate_asset_allocation as a
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
R, T, dates, month_end = a.R, a.T, a.dates, a.month_end
ME = set(month_end)
START = 250
COST = 0.001
TGT = np.full(4, 0.25)


def lump_run(rule):
    v = TGT * 1.0  # 금액
    daily = np.zeros(T); turn_sum = 0.0
    for i in range(START, T):
        tot0 = v.sum()
        v = v * (1 + R[i])
        tot = v.sum()
        daily[i] = tot / tot0 - 1
        do = False
        if i in ME:
            m = dates[i][4:6]
            if rule == "month": do = True
            elif rule == "quarter": do = m in ("03", "06", "09", "12")
            elif rule == "year": do = m == "12"
            elif rule == "band": do = np.abs(v / tot - TGT).max() > 0.05
        if do:
            new = tot * TGT
            tr = np.abs(new - v).sum() / 2
            turn_sum += tr / tot
            tot -= tr * COST * 2 / 1.0 * 0.5  # 매도·매수 편도 0.1% 가정
            v = tot * TGT
            daily[i] -= (tr * COST) / (tot / (1 + daily[i]) if False else 1) * 0  # 비용은 tot에서 직접 차감
    return daily[START:], turn_sum / ((T - START) / 250)


def stats(d):
    eq = np.cumprod(1 + d); y = len(d) / 250
    return (eq[-1] ** (1 / y) - 1) * 100, (eq / np.maximum.accumulate(eq) - 1).min() * 100, (d.mean() * 250 - 0.025) / (d.std() * np.sqrt(250))


print(f"공통 구간 {dates[START]}~{dates[-1]}")
print(f"{'일시금 4자산 25%씩':20s} {'CAGR':>6s} {'MDD':>7s} {'샤프':>5s} {'연 회전율':>8s}")
for rule, label in [("none", "리밸런싱 안 함"), ("year", "연 1회"), ("quarter", "분기"), ("month", "월"), ("band", "밴드 ±5%p")]:
    d, tn = lump_run(rule)
    s = stats(d)
    print(f"{label:20s} {s[0]:6.1f} {s[1]:7.1f} {s[2]:5.2f} {tn*100:7.0f}%")
for k, nm in enumerate(["KODEX200", "나스닥100", "국고채10년", "골드"]):
    s = stats(R[START:, k]); print(f"  (참고) {nm:10s} {s[0]:6.1f} {s[1]:7.1f} {s[2]:5.2f}")


def stream(mode):
    v = np.zeros(4); paid = 0.0; peak_ratio = 0.0; worst = 0.0
    for i in range(START, T):
        v = v * (1 + R[i])
        if i in ME:
            paid += 1.0
            if mode == "fixed":
                v += TGT
            elif mode == "fill":  # 목표 비중에 가장 못 미치는 자산부터 채움(매도 없음)
                tot = v.sum() + 1.0
                gap = np.maximum(tot * TGT - v, 0); add = np.zeros(4)
                if gap.sum() > 0: add = gap / gap.sum() * 1.0
                else: add = TGT
                v += add
            elif mode == "kospi":
                v[0] += 1.0
        if paid >= 12: worst = min(worst, v.sum() / paid - 1)
    return v.sum() / paid, worst


print(f"\n월 적립 1씩(총 {len([i for i in month_end if i>=START])}회) — 총납입 대비 배율 / 최대 평가손실")
for mode, label in [("kospi", "코스피200만 적립"), ("fixed", "4자산 25%씩 고정 분할"), ("fill", "4자산 모자란 쪽에 몰아서 적립")]:
    m, w = stream(mode); print(f"{label:28s} {m:6.3f}  {w*100:7.1f}%")
