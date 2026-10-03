# -*- coding: utf-8 -*-
"""
신형 커버드콜 구조의 하락장·박스권 분배금과 기준가(원금) 점검 — 합성 (2026-10-03).
실제 신형 상품은 상장 1~3년이라 하락장 이력이 없다. 그래서 validate_cc_vix.py와 같은 모델(실제 VIX × 0.9로 블랙-숄즈 옵션 가격, S&P500 가격지수 1990~2026)에서
옵션 프리미엄을 **분배금으로 전부 지급**한다고 보고 기준가(NAV, 분배 제외 원금)와 분배금을 따로 추적한다.
 - 분배금 = 롤마다 커버율×프리미엄(비용 차감) × 그 시점 기준가. 기준가 = 기초 수익 − 커버율×max(기초 수익 − OTM, 0)를 누적(분배금은 재투자하지 않음).
 - 월별 분배율(연환산) = 그 달 분배금 ÷ 월초 기준가 × 12.
구간: 2008~2009-03(금융위기), 2020(코로나), 2022(금리 급등 하락), 2015~2016(박스권), 2018 4분기, 전체.
한계: VIX(30일 ATM) 기반 프리미엄이라 주간·데일리 옵션의 실제 프리미엄과 다르고 스큐·스프레드는 0.9 보정에 뭉뚱그림. 실제 상품은 분배금 평활화·목표 분배 규칙이 있어 이 모델의 월 분배와 다르다. 분배율은 가격 지수 기준(배당 제외).
"""
import json, math, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
g = dict(json.load(open(".research-cache/yh_GSPC_daily.json"))); v = dict(json.load(open(".research-cache/yh_VIX_daily.json")))
dates = [d for d in sorted(g) if d in v]
px = np.array([g[d] for d in dates]); vix = np.array([v[d] for d in dates]) / 100; n = len(px)
KADJ = 0.9
def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def bs(s, T, o):
    K = 1 + o
    if s <= 0 or T <= 0: return max(1 - K, 0)
    d1 = (math.log(1 / K) + s * s / 2 * T) / (s * math.sqrt(T)); d2 = d1 - s * math.sqrt(T)
    return ncdf(d1) - K * ncdf(d2)
def run(step, c, otm):
    nav = np.ones(n); pay = np.zeros(n)   # pay[j] = 롤 시점 j에 지급되는 분배금(그 시점 기준가 대비 비율 × nav)
    cur = 1.0; i = 0
    while i < n - 1:
        j = min(i + step, n - 1)
        prem = bs(vix[i] * KADJ, (j - i) / 252, otm); under = px[j] / px[i] - 1
        inc = cur * (c * prem - c * 0.0003)
        for t in range(i + 1, j + 1):
            f = px[t] / px[i] - 1
            nav[t] = cur * (1 + f - c * (max(f - otm, 0) if t == j else 0))
        cur = cur * (1 + under - c * max(under - otm, 0)); nav[j] = cur
        pay[j] = inc; i = j
    return nav, pay
months = np.array([d[:6] for d in dates])
def monthly_yield(nav, pay):
    out = {}
    for m in sorted(set(months)):
        idx = np.where(months == m)[0]
        start_nav = nav[idx[0] - 1] if idx[0] > 0 else 1.0
        out[m] = pay[idx].sum() / start_nav * 12 * 100
    return out
REG = [("2008~2009-03 금융위기", "200801", "200903"), ("2011 하반기", "201107", "201112"), ("2015~2016 박스권", "201501", "201612"), ("2018 4분기", "201810", "201812"), ("2020 코로나", "202001", "202012"), ("2022 금리 급등", "202201", "202212"), ("전체 1990~2026", "199001", "202612")]
CONF = [("월물 ATM 100%(1세대형)", 21, 1.0, 0.0), ("주간 ATM 50%(2세대형)", 5, 0.5, 0.0), ("주간 OTM2% 50%", 5, 0.5, 0.02), ("데일리 ATM 30%(3세대형 근사)", 1, 0.3, 0.0)]
res = {nm: run(*a) for nm, *a in [(c[0], c[1], c[2], c[3]) for c in CONF]}
def period_change(arr, lo, hi):
    idx = [i for i, m in enumerate(months) if lo <= m <= hi]
    a = arr[idx[0] - 1] if idx[0] > 0 else arr[idx[0]]
    return (arr[idx[-1]] / a - 1) * 100
for rn, lo, hi in REG:
    idx = [i for i, m in enumerate(months) if lo <= m <= hi]
    yrs = len(idx) / 252
    print(f"\n### {rn} ({yrs:.1f}년) — 지수(가격) {period_change(px, lo, hi):+.0f}%")
    print(f"{'구성':30s} {'기준가 변화':>10s} {'연 분배율 평균':>12s} {'월 분배율 최저(연환산)':>20s} {'분배율 평균의 50% 미만 달':>20s} {'기준가+누적분배 합':>16s}")
    for nm, (nav, pay) in res.items():
        my = monthly_yield(nav, pay); ks = [m for m in my if lo <= m <= hi]
        ys = np.array([my[m] for m in ks])
        navc = period_change(nav, lo, hi)
        base = nav[[i for i, m in enumerate(months) if lo <= m <= hi][0] - 1] if idx[0] > 0 else 1.0
        totp = pay[idx].sum() / base * 100
        print(f"{nm:30s} {navc:+9.0f}% {ys.mean():11.1f}% {ys.min():19.1f}% {(ys < 0.5 * ys.mean()).mean() * 100:18.0f}% {navc + totp:+14.0f}%")
