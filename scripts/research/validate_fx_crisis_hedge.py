# -*- coding: utf-8 -*-
"""
H13 원화 투자자에게 미국 지수 환노출은 위기 때 자연 헤지인가 — 사건 단위 판정과 환헤지 비용 (2026-10-06).

부록 9(validate_fx_rates.py)는 월 상관(−0.51)과 최악 12개월 평균으로 '완충'을 보였다. 여기서는 사건 단위로 본다.
사전 판정 기준(가설 장부 H13): S&P500(달러 총수익) 고점 대비 −20% 이상 하락 사건에서 원화 환산 최대 낙폭이
  달러 기준보다 5%p 이상 작고, 사건의 2/3 이상에서 같은 방향이면 채택.
데이터: SPY 수정주가 일봉(달러 총수익), 원/달러 일봉(us_KRW_X, 2003-12~), CD91, 미국 3개월물(IRX 월말).
환헤지 근사: 헤지 수익 ≈ 달러 수익 + (한국 CD91 − 미국 3개월물) — 선물환 프리미엄 근사, 헤지 상품 보수·롤 비용 제외.
"""
import json
import sys

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
AW = ".research-cache/allweather/"

spy = {r[0]: float(r[1]) for r in json.load(open(AW + "us_SPY.json")) if r[1]}
fx = {r[0]: float(r[-1]) for r in json.load(open(AW + "us_KRW_X.json")) if r[-1] and float(r[-1]) > 500}
dates = sorted(d for d in spy if d in fx)
usd = np.array([spy[d] for d in dates])
krw = np.array([spy[d] * fx[d] for d in dates])
print(f"공통 일봉 {dates[0]}~{dates[-1]} ({len(dates)}일)")


def events(series, thr):
    """고점 대비 thr 이상 하락한 사건: (고점 idx, 저점 idx, 회복 idx 또는 끝)"""
    out, peak_i, i = [], 0, 0
    n = len(series)
    while i < n:
        if series[i] >= series[peak_i]:
            peak_i = i
        elif series[i] / series[peak_i] - 1 <= -thr:
            j = i
            trough = i
            while j < n and series[j] < series[peak_i]:
                if series[j] < series[trough]:
                    trough = j
                j += 1
            out.append((peak_i, trough, min(j, n - 1)))
            peak_i = j if j < n else n - 1
            i = j
            continue
        i += 1
    return out


def mdd(x):
    return (x / np.maximum.accumulate(x) - 1).min() * 100


for thr in (0.20, 0.15):
    ev = events(usd, thr)
    print(f"\n=== S&P500 달러 기준 −{thr*100:.0f}% 이상 하락 사건 {len(ev)}건 ===")
    better = 0
    for p, t, r in ev:
        # 같은 구간(달러 고점 ~ 달러 회복) 안에서 원화 기준 최대 낙폭
        u = usd[p:t + 1][-1] / usd[p] - 1
        k_mdd = mdd(krw[p:r + 1])
        u_mdd = (usd[t] / usd[p] - 1) * 100
        fx_chg = (fx[dates[t]] / fx[dates[p]] - 1) * 100
        rec_k = next((dates[i] for i in range(t, len(dates)) if krw[i] >= krw[p]), "미회복")
        gap = k_mdd - u_mdd
        better += gap >= 5
        print(f"  {dates[p]}→{dates[t]} 회복 {dates[r]}: 달러 {u_mdd:6.1f}% | 원화 최대낙폭 {k_mdd:6.1f}% (차 {gap:+5.1f}%p) | 고점→저점 환율 {fx_chg:+5.1f}% | 원화 회복 {rec_k}")
    if thr == 0.20:
        verdict = len(ev) and better / len(ev) >= 2 / 3
        print(f"  사전 기준(5%p 이상 덜 빠진 사건 ≥ 2/3): {better}/{len(ev)} → {'채택' if verdict else '기각'}")

# --- 환헤지 비용 (월) ---
irx = json.load(open(".research-cache/yh_IRX_me.json"))
cd = sorted(json.load(open(AW + "cd91.json")))
cdm = {}
for d, v in cd:
    cdm[d[:6]] = float(v)
me = {}
for i, d in enumerate(dates):
    me[d[:6]] = i
months = [m for m in sorted(me) if m in irx and m in cdm]
idx = [me[m] for m in months]
r_usd = np.array([usd[idx[i]] / usd[idx[i - 1]] - 1 for i in range(1, len(idx))])
r_krw = np.array([krw[idx[i]] / krw[idx[i - 1]] - 1 for i in range(1, len(idx))])
carry = np.array([(cdm[months[i - 1]] - irx[months[i - 1]]) / 100 / 12 for i in range(1, len(idx))])
r_hdg = r_usd + carry


def cagr(r):
    return (np.prod(1 + r) ** (12 / len(r)) - 1) * 100


def mddm(r):
    return mdd(np.concatenate([[1.0], np.cumprod(1 + r)]))


print(f"\n=== 환노출 vs 환헤지(근사) — 월, {months[0]}~{months[-1]} ===")
print(f"한미 단기금리차(CD91 − 미국 3개월물) 평균 연 {carry.mean()*1200:+.2f}%p, 최근 12개월 {carry[-12:].mean()*1200:+.2f}%p")
print(f"{'':10s} {'연수익':>7s} {'변동성':>7s} {'최대낙폭':>8s}")
for lab, r in [("환노출", r_krw), ("환헤지", r_hdg), ("(달러)", r_usd)]:
    print(f"{lab:10s} {cagr(r):6.1f}% {r.std()*np.sqrt(12)*100:6.1f}% {mddm(r):7.1f}%")
half = len(r_krw) // 2
for lab, sl in [("전반", slice(0, half)), ("후반", slice(half, None))]:
    print(f"  {lab} {months[sl][0] if isinstance(months[sl], list) else ''}: 환노출 연 {cagr(r_krw[sl]):.1f}%·낙폭 {mddm(r_krw[sl]):.1f}% | 환헤지 연 {cagr(r_hdg[sl]):.1f}%·낙폭 {mddm(r_hdg[sl]):.1f}% | 금리차 연 {carry[sl].mean()*1200:+.2f}%p")
# 10년 창 승률
H = 120
w = [np.prod(1 + r_krw[s:s + H]) > np.prod(1 + r_hdg[s:s + H]) for s in range(len(r_krw) - H + 1)]
print(f"10년 보유 창 {len(w)}개 중 환노출이 더 남긴 비율 {np.mean(w)*100:.0f}%")
