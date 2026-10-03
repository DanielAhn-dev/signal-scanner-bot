# -*- coding: utf-8 -*-
"""
VKOSPI 실측값으로 한국 커버드콜 합성 모델의 "상품이 시장 내재변동성의 몇 %를 실제로 받는가"를 역산 (2026-10-03).
validate_kr_implied_k.py(내재변동성=직전 실현변동성×k)와 같은 모델이지만 내재변동성에 실제 VKOSPI(.research-cache/vkospi.json)를 쓰고
곱하는 배수 m(체결·구조 보정)을 실제 상품 실적(상품 총수익 ÷ KODEX200 총수익)과 맞춰 찾는다. m=1이면 시장 내재변동성 그대로 판다는 뜻.
가설(부록 14): 한국 옵션이 싼 게 아니라 상품이 프리미엄을 다 받지 못한다 → m이 1보다 많이 작으면 확인.
한계: 상품 구조(커버율·행사가·롤) 가정, 지수 배당 미반영, 구간이 한국 강세장 한 번, 상품 3개.
"""
import json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_income_then_growth import monthly  # noqa: E402
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
vk = dict(json.load(open(".research-cache/vkospi.json")))
rows = json.load(open(".research-cache/kospi.json", encoding="utf-8")); rows.sort(key=lambda r: r[0])
dates = [r[0] for r in rows]; px = np.array([float(r[1]) for r in rows]); lr = np.diff(np.log(px)); N = len(px)
R_F = 0.03
def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def bs(sig, T, otm):
    K = 1 + otm
    if sig <= 0 or T <= 0: return max(1 - K, 0)
    d1 = (math.log(1 / K) + (R_F + sig * sig / 2) * T) / (sig * math.sqrt(T)); d2 = d1 - sig * math.sqrt(T)
    return ncdf(d1) - K * math.exp(-R_F * T) * ncdf(d2)
def vk_at(i):
    for j in range(i, max(0, i - 6), -1):
        if dates[j] in vk: return vk[dates[j]] / 100
    return None
def synth(i0, i1, step, c, otm, k):
    cur = 1.0; i = i0
    while i < i1:
        j = min(i + step, i1)
        v0 = vk_at(i); vol = max(0.10, (v0 if v0 else lr[max(0, i - 20):i].std() * math.sqrt(252) * 1.25) * k)
        prem = bs(vol, (j - i) / 252, otm); u = px[j] / px[i] - 1
        cur *= 1 + u - c * max(u - otm, 0) + c * prem - c * 0.0003
        i = j
    return cur
kodex = monthly(".research-cache/index_etfs/px_069500.json")
TESTS = [("289480", "TIGER200CC(월물 ATM 100%)", 21, 1.0, 0.0), ("475720", "RISE200위클리CC(주간 ATM, 커버율 가정 50%)", 5, 0.5, 0.0), ("498400", "KODEX200타겟위클리CC(주간 ATM, 커버율 가정 30%)", 5, 0.3, 0.0)]
print(f"KOSPI 일별 {dates[0]}~{dates[-1]}")
for code, name, step, c, otm in TESTS:
    cc = monthly(f".research-cache/dividend_etfs/px_{code}.json")
    divs = json.load(open(f".research-cache/div_{code}.json", encoding="utf-8"))
    first = min(x["recordDate"][:4] + x["recordDate"][5:7] for x in divs)
    ms = [m for m in sorted(cc) if m >= first and m in kodex]
    a0, a1 = ms[0], ms[-1]
    actual = (cc[a1] / cc[a0]) / (kodex[a1] / kodex[a0])
    # 합성 구간: 월말 기준 시작·끝 일자
    def last_idx(m): return max(i for i, d in enumerate(dates) if d[:6] == m)
    i0, i1 = last_idx(a0), last_idx(a1)
    idx_ratio = px[i1] / px[i0]
    best = None
    out = []
    for k in np.arange(0.3, 1.51, 0.05):
        r = synth(i0, i1, step, c, otm, float(k)) / idx_ratio
        out.append((float(k), r)); 
        if best is None or abs(r - actual) < abs(best[1] - actual): best = (float(k), r)
    # 보간으로 actual과 만나는 k
    ks = np.array([o[0] for o in out]); rs = np.array([o[1] for o in out])
    cross = None
    for a in range(len(rs) - 1):
        if (rs[a] - actual) * (rs[a + 1] - actual) <= 0 and rs[a + 1] != rs[a]:
            cross = ks[a] + (actual - rs[a]) * (ks[a + 1] - ks[a]) / (rs[a + 1] - rs[a]); break
    print(f"\n{name} {a0}~{a1}  실제 (상품 TR ÷ KODEX200 TR) = {actual:.2f}")
    print("   합성(지수 가격 대비) m=" + ", ".join(f"{k:.1f}:{r:.2f}" for k, r in out[::4]))
    print(f"   → 실제와 가장 가까운 m = {best[0]:.2f} (합성 {best[1]:.2f})" + (f", 보간 교차 m ≈ {cross:.2f}" if cross else ", 범위 안에서 교차 없음"))
