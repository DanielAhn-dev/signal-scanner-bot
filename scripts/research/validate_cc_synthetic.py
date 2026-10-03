# -*- coding: utf-8 -*-
"""
커버드콜 구조별 합성 점검 (2026-10-03) — 실제 상품 이력이 짧아(신형은 1~2년) KOSPI 일별 지수 1996~2026에 옵션 매도를 '가정'으로 얹어 길게 본다.
가정(전부 가정이며 실제 상품과 다르다):
  - 매 만기(데일리 1일/주간 5거래일/월물 21거래일)마다 기초지수 콜을 판다. 가격은 블랙-숄즈, 무위험 3%, 변동성 = 직전 20거래일 실현변동성 × k (k = 내재/실현 프리미엄 가정, 0.9/1.0/1.2), 하한 10%.
  - 커버율 c(0.3~1.0), 행사가 = 현재가×(1+OTM%). 프리미엄은 즉시 재투자, 거래비용은 롤마다 c×0.03%. 배당·세금 제외(지수는 가격지수).
  - 수익 = 기초 수익 − c×max(만기 수익−OTM,0) + c×프리미엄(비율) − 비용.
구성: A 월물ATM100%(1세대형) / B 월물OTM3% 100% / C 주간ATM50%(2세대형) / D 주간OTM2% 50% / E 데일리ATM30%(3세대형 근사)
지표: 연환산, 최대낙폭, 월 상승월·하락월 포착률, 최악 연도, 구간별(2008, 2021-01~2026-06 '3000→9000', 2022).
한계: 실제 상품은 분배금 평활화·옵션 스프레드·롤 타이밍·한국 옵션 유동성이 달라 이 결과는 구조적 경향을 보는 용도다. k(프리미엄 가정)에 결과가 크게 의존한다.
"""
import json, math, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
rows = json.load(open(".research-cache/kospi.json", encoding="utf-8")); rows.sort(key=lambda r: r[0])
dates = [r[0] for r in rows]; px = np.array([float(r[1]) for r in rows])
R_F = 0.03

def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def bs_call_ratio(sigma, T, otm):
    """S=1, K=1+otm 콜 가격(비율)"""
    K = 1 + otm
    if sigma <= 0 or T <= 0: return max(1 - K, 0)
    d1 = (math.log(1 / K) + (R_F + sigma ** 2 / 2) * T) / (sigma * math.sqrt(T)); d2 = d1 - sigma * math.sqrt(T)
    return ncdf(d1) - K * math.exp(-R_F * T) * ncdf(d2)

lr = np.diff(np.log(px))
def simulate(step, c, otm, k):
    """일별 자산가치 경로(시작 1). 롤 시점마다 기초 수익과 옵션 손익을 반영"""
    n = len(px)
    v = np.ones(n)
    cur = 1.0
    i = 0
    idx_path = [0]
    while i < n - 1:
        j = min(i + step, n - 1)
        vol = max(0.10, lr[max(0, i - 20):i].std() * math.sqrt(252) * k) if i >= 5 else 0.20
        prem = bs_call_ratio(vol, (j - i) / 252, otm)
        under = px[j] / px[i] - 1
        ret = under - c * max(under - otm, 0) + c * prem - c * 0.0003
        # 구간 중 일별 경로: 기초 일별 수익을 비례해서 쓰고 마지막에 옵션 손익을 반영(낙폭은 일별 기초 기준 근사)
        for t in range(i + 1, j + 1):
            frac = px[t] / px[i] - 1
            v[t] = cur * (1 + frac - c * max(frac - otm, 0) * (1 if t == j else 0) + c * prem * (t - i) / (j - i))
        cur *= 1 + ret
        v[j] = cur
        i = j
    return v

def stats(v, lo=None, hi=None):
    d = np.array(dates)
    sel = np.ones(len(v), bool)
    if lo: sel &= d >= lo
    if hi: sel &= d <= hi
    w = v[sel] / v[sel][0]
    pk = np.maximum.accumulate(w)
    yrs = sel.sum() / 252
    return (w[-1] ** (1 / yrs) - 1) * 100, ((w / pk - 1).min()) * 100, (w[-1] - 1) * 100

def capture(v):
    # 월말 기준 월수익률
    d = np.array([x[:6] for x in dates]); last = {}
    for i, m in enumerate(d): last[m] = i
    ms = sorted(last); ids = [last[m] for m in ms]
    rp = np.diff(v[ids]) / v[ids][:-1]; rb = np.diff(px[ids]) / px[ids][:-1]
    up, dn = rb > 0, rb < 0
    return rp[up].mean() / rb[up].mean() * 100, rp[dn].mean() / rb[dn].mean() * 100

CONFIGS = [("A 월물 ATM 100%(1세대형)", 21, 1.0, 0.0), ("B 월물 OTM3% 100%", 21, 1.0, 0.03), ("C 주간 ATM 50%(2세대형)", 5, 0.5, 0.0),
           ("D 주간 OTM2% 50%", 5, 0.5, 0.02), ("E 데일리 ATM 30%(3세대형 근사)", 1, 0.3, 0.0)]
print(f"KOSPI 일별 {dates[0]}~{dates[-1]} ({len(px)}일) — 지수 가격지수 연환산 {((px[-1]/px[0])**(252/len(px))-1)*100:.1f}%")
base = px / px[0]
for k in (1.0, 0.9, 1.2):
    print(f"\n########## 프리미엄 가정 k={k} (내재변동성 = 실현변동성 × k) ##########")
    print(f"{'구성':30s} {'연환산':>7s} {'최대낙폭':>8s} {'상승포착':>7s} {'하락포착':>7s} | 2008 | 2021-01~2026-06 연환산/총수익 | 2022")
    ci, cm, cc_ = stats(base), None, None
    up, dn = capture(base)
    s08 = stats(base, '20080101', '20081231'); s21 = stats(base, '20210101', '20260630'); s22 = stats(base, '20220101', '20221231')
    print(f"{'지수(가격)':30s} {ci[0]:6.1f}% {ci[1]:7.1f}% {up:6.0f}% {dn:6.0f}% | {s08[2]:+4.0f}% | {s21[0]:5.1f}% / {s21[2]:+5.0f}% | {s22[2]:+4.0f}%")
    for name, step, c, otm in CONFIGS:
        v = simulate(step, c, otm, k)
        s = stats(v); up, dn = capture(v)
        s08 = stats(v, '20080101', '20081231'); s21 = stats(v, '20210101', '20260630'); s22 = stats(v, '20220101', '20221231')
        print(f"{name:30s} {s[0]:6.1f}% {s[1]:7.1f}% {up:6.0f}% {dn:6.0f}% | {s08[2]:+4.0f}% | {s21[0]:5.1f}% / {s21[2]:+5.0f}% | {s22[2]:+4.0f}%")
