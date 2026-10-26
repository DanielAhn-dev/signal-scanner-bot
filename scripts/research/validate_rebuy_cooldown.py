# -*- coding: utf-8 -*-
"""
H68 (2026-10-26): 손절 직후(10거래일 이내) 같은 종목을 다시 사면 같은 달 다른 진입보다 이후 20거래일 성과가 나쁜가.
판정 기준은 docs/hypothesis-ledger.md H68에 결과 보기 전 고정돼 있다. 여기서 기준을 바꾸지 않는다.
쿨다운 길이는 10거래일 하나만 본다(격자 금지).

진입·유니버스·CUR 청산·비용은 H67과 같다(validate_half_take_profit.simulate / top_mask, 익절 +8%).
손절일 = 한 달 코호트 진입의 경로에서 종가가 처음 -7% 이하가 된 날.
차단 대상 = 다음 달 첫 거래일 진입 시점에 손절일로부터 1~10거래일 지난 종목. 손절일이 새 진입일 이후면 제외.
비차단 = 전 달 손절이 없거나 10거래일 넘게 지난 같은 달 진입.

실행: python scripts/research/validate_rebuy_cooldown.py
"""
import sys, os
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_half_take_profit as h

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

dates, T, Cf = h.dates, h.T, h.Cf
H = h.H
COOLDOWN = 10


def main():
    first_days, seen = [], set()
    for i, d in enumerate(dates):
        if d[:6] not in seen:
            seen.add(d[:6])
            first_days.append(i)
    first_days = [t for t in first_days if t >= 21 and t + H < T]

    prev_stop = {}  # 종목 j -> 직전 코호트 진입에서의 손절일(전역 인덱스) 또는 None
    rows = []  # (date, blocked, ret)
    for t in first_days:
        mask = h.top_mask(t)
        new_stop = {}
        for j in np.where(mask)[0]:
            path = Cf[t : t + H + 1, j]
            if not np.isfinite(path[0]) or path[0] <= 0:
                continue
            ret, _ = h.simulate(path, 0.08)
            # 이 진입의 손절일(처음 -7% 이하)
            rr = path[1:] / path[0] - 1
            hit = np.where(np.isfinite(rr) & (rr <= -0.07))[0]
            new_stop[j] = (t + 1 + int(hit[0])) if len(hit) else None
            ps = prev_stop.get(j, "none")
            if ps == "none":
                blocked = False  # 전 달 진입 기록 없음 → 비차단
            elif ps is None:
                blocked = False  # 전 달 손절 없음
            else:
                since = t - ps
                if since <= 0:
                    continue  # 손절일이 새 진입일 이후 — 제외
                blocked = since <= COOLDOWN
            rows.append((dates[t], blocked, ret))
        prev_stop = new_stop

    ds = np.array([r[0] for r in rows])
    bl = np.array([r[1] for r in rows])
    rt = np.array([r[2] for r in rows])
    print(f"분석 진입 {len(rows):,}건 · 차단 대상 {int(bl.sum()):,}건 · 비차단 {int((~bl).sum()):,}건")

    # 같은 달 코호트 내 비차단 평균 대비 차이(월별 집계)
    months = sorted(set(d[:6] for d in ds))
    per_month = {}
    for m in months:
        mm = np.array([d[:6] == m for d in ds])
        if (mm & bl).sum() >= 10 and (mm & ~bl).sum() >= 10:
            per_month[m] = rt[mm & bl].mean() - rt[mm & ~bl].mean()

    def period_diff(sel):
        # 같은 달 비차단 평균을 기준으로 차단 대상 한 건씩의 초과를 평균
        vals = []
        for m in months:
            if not sel(m):
                continue
            mm = np.array([d[:6] == m for d in ds])
            if (mm & bl).sum() == 0 or (mm & ~bl).sum() == 0:
                continue
            base = rt[mm & ~bl].mean()
            vals.extend((rt[mm & bl] - base).tolist())
        return (np.mean(vals) if vals else float("nan")), len(vals)

    d1, n1 = period_diff(lambda m: m < "202201")
    d2, n2 = period_diff(lambda m: m >= "202201")
    d0, n0 = period_diff(lambda m: True)
    print(f"\nⓑ 차단 − 비차단 평균 차이 (같은 달 기준)")
    print(f"  2014~2021: {d1*100:+.2f}%p (차단 {n1:,}건)")
    print(f"  2022~2026: {d2*100:+.2f}%p (차단 {n2:,}건)")
    print(f"  전체     : {d0*100:+.2f}%p (차단 {n0:,}건)")

    pm = np.array(list(per_month.values()))
    tstat = pm.mean() / (pm.std(ddof=1) / np.sqrt(len(pm))) if len(pm) > 2 else float("nan")
    print(f"\nⓒ 월별 차이(양쪽 10건 이상인 달 {len(pm)}개) 평균 {pm.mean()*100:+.2f}%p · t = {tstat:.2f}")

    ydiff = {}
    for y in sorted(set(m[:4] for m in per_month)):
        v = [x for m, x in per_month.items() if m[:4] == y]
        ydiff[y] = float(np.mean(v))
    neg = sum(1 for v in ydiff.values() if v < 0)
    print(f"\nⓓ 연도별 차이 음수 {neg}/{len(ydiff)}년 ({neg/max(1,len(ydiff))*100:.0f}%)")
    print("   " + " ".join(f"{y}:{v*100:+.2f}" for y, v in ydiff.items()))

    checks = {
        "ⓐ 차단 N≥1,000": int(bl.sum()) >= 1000,
        "ⓑ 두 구간 모두 ≤ -1.0%p": d1 <= -0.01 and d2 <= -0.01,
        "ⓒ 월별 t ≤ -2": tstat <= -2,
        "ⓓ 음수 연도 ≥ 70%": ydiff and neg / len(ydiff) >= 0.7,
    }
    print("\n판정(H68 사전 기준)")
    for k, v in checks.items():
        print(f"  {'통과' if v else '불통과'}  {k}")
    if not checks["ⓐ 차단 N≥1,000"]:
        print("→ 보류")
    else:
        print("→ 통과 (B-7 후보, 도입 아님)" if all(checks.values()) else "→ 기각")


if __name__ == "__main__":
    main()
