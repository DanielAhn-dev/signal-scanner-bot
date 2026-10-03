# -*- coding: utf-8 -*-
"""
커버드콜 구조별 점검 — 가정 k 대신 실제 VIX를 옵션 내재변동성으로 사용 (2026-10-03).
validate_cc_synthetic.py는 내재변동성을 '직전 20일 실현변동성 × k'로 가정했다. 한국은 변동성지수(VKOSPI) 자료가 없어 못 하지만, 미국은 VIX와 S&P500 일별(1990~2026)이 있다.
(1) VIX ÷ 직전 20일 실현변동성(=합성 점검의 k에 해당) 분포와, VIX ÷ 이후 21일 실현변동성(옵션 매도자가 실제로 받는 프리미엄 비율)을 잰다.
(2) 같은 구조(월물 ATM 100%/월물 OTM3%/주간 ATM 50%/주간 OTM2% 50%/데일리 ATM 30%)를 VIX로 가격 매겨 S&P500 가격지수에 적용한다(블랙-숄즈, 무위험 = 0, 비용 롤마다 커버율×0.03%, 프리미엄 재투자, 배당 제외).
가정/한계: VIX는 30일 만기 ATM 내재변동성이라 주간·데일리 옵션의 실제 내재변동성(보통 더 높거나 낮음, 이벤트·기간구조)과 다르다. 스큐(OTM 가격 차이) 무시. 실제 상품 수익과 다르다.
"""
import json, math, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
g = dict(json.load(open(".research-cache/yh_GSPC_daily.json"))); v = dict(json.load(open(".research-cache/yh_VIX_daily.json")))
dates = [d for d in sorted(g) if d in v]
px = np.array([g[d] for d in dates]); vix = np.array([v[d] for d in dates]) / 100
lr = np.diff(np.log(px)); n = len(px)
def rv(a, b): return lr[a:b].std() * math.sqrt(252)
# (1) k 측정
trail, fwd = [], []
for i in range(25, n - 22, 5):
    t = rv(i - 20, i); f = rv(i, i + 21)
    if t > 0 and f > 0: trail.append(vix[i] / t); fwd.append(vix[i] / f)
trail, fwd = np.array(trail), np.array(fwd)
print(f"S&P500+VIX {dates[0]}~{dates[-1]} ({n}일)")
print(f"VIX ÷ 직전 20일 실현변동성(합성 점검의 k): 중앙값 {np.median(trail):.2f}, 평균 {trail.mean():.2f}, 25~75% {np.percentile(trail,25):.2f}~{np.percentile(trail,75):.2f}")
print(f"VIX ÷ 이후 21일 실현변동성(매도자가 받는 프리미엄): 중앙값 {np.median(fwd):.2f}, 평균 {fwd.mean():.2f}, 25~75% {np.percentile(fwd,25):.2f}~{np.percentile(fwd,75):.2f}, 1 미만(프리미엄이 모자란) 비율 {(fwd<1).mean()*100:.0f}%")
def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def bs(sig, T, otm):
    K = 1 + otm
    if sig <= 0 or T <= 0: return max(1 - K, 0)
    d1 = (math.log(1 / K) + sig ** 2 / 2 * T) / (sig * math.sqrt(T)); d2 = d1 - sig * math.sqrt(T)
    return ncdf(d1) - K * ncdf(d2)
KADJ = 1.0
def simulate(step, c, otm):
    val = np.ones(n); cur = 1.0; i = 0
    while i < n - 1:
        j = min(i + step, n - 1)
        prem = bs(vix[i] * KADJ, (j - i) / 252, otm)
        under = px[j] / px[i] - 1
        cur_new = cur * (1 + under - c * max(under - otm, 0) + c * prem - c * 0.0003)
        for t in range(i + 1, j + 1):
            f = px[t] / px[i] - 1
            val[t] = cur * (1 + f - c * (max(f - otm, 0) if t == j else 0) + c * prem * (t - i) / (j - i))
        cur = cur_new; val[j] = cur; i = j
    return val
def stats(vv, lo=None, hi=None):
    d = np.array(dates); sel = np.ones(n, bool)
    if lo: sel &= d >= lo
    if hi: sel &= d <= hi
    w = vv[sel] / vv[sel][0]; pk = np.maximum.accumulate(w); yrs = sel.sum() / 252
    return (w[-1] ** (1 / yrs) - 1) * 100, (w / pk - 1).min() * 100, (w[-1] - 1) * 100
def capture(vv):
    d = np.array([x[:6] for x in dates]); last = {}
    for i, m in enumerate(d): last[m] = i
    ids = [last[m] for m in sorted(last)]
    rp = np.diff(vv[ids]) / vv[ids][:-1]; rb = np.diff(px[ids]) / px[ids][:-1]
    return rp[rb > 0].mean() / rb[rb > 0].mean() * 100, rp[rb < 0].mean() / rb[rb < 0].mean() * 100
CONF = [("월물 ATM 100%(1세대형)", 21, 1.0, 0.0), ("월물 OTM3% 100%", 21, 1.0, 0.03), ("주간 ATM 50%(2세대형)", 5, 0.5, 0.0), ("주간 OTM2% 50%", 5, 0.5, 0.02), ("데일리 ATM 30%(3세대형 근사)", 1, 0.3, 0.0)]
base = px / px[0]
print("\n보정 근거: 같은 모델을 나스닥100·VXN에 적용해 실제 QYLD(2014~2026, QQQ 대비 0.30배)와 비교하면 VXN×1.0에서는 합성이 0.50배로 낙관적이고 ×0.9에서 0.34배로 실제에 가깝다. 스프레드·스큐·체결 손실을 합쳐 매도 가격이 내재변동성의 약 90%라고 보정한다(미국 한정 보정).")
def per(vv): return " | ".join(f"{stats(vv, lo, hi)[2]:+4.0f}%" for lo, hi in (("20080101", "20081231"), ("20200101", "20201231"), ("20220101", "20221231"), ("20240101", "20261231")))
for KADJ in (1.0, 0.9):
    print(f"\n=== 실제 VIX x {KADJ} 가격으로 본 구조별 결과 (S&P500 가격지수, 1990~2026) ===")
    print(f"{'구성':30s} {'연환산':>7s} {'최대낙폭':>8s} {'상승포착':>7s} {'하락포착':>7s} | 2008 | 2020 | 2022 | 2024~2026")
    s0 = stats(base); u, dn = capture(base)
    print(f"{'지수(가격)':30s} {s0[0]:6.1f}% {s0[1]:7.1f}% {u:6.0f}% {dn:6.0f}% | {per(base)}")
    for nm, step, c, otm in CONF:
        vv = simulate(step, c, otm); s = stats(vv); u, dn = capture(vv)
        print(f"{nm:30s} {s[0]:6.1f}% {s[1]:7.1f}% {u:6.0f}% {dn:6.0f}% | {per(vv)}")
