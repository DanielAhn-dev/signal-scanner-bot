# -*- coding: utf-8 -*-
"""
한국 커버드콜 실제 실적으로 합성 모델의 옵션 가격 가정 k를 역산 (2026-10-03). KRX에 VKOSPI 일별 자료가 없어(메뉴에서 확인 못 함) 간접 추정한다.
방법: KOSPI 일별 가격지수(.research-cache/kospi.json)에 월물 ATM 100% 커버드콜을 합성(validate_cc_synthetic.simulate와 같은 모델, 내재변동성 = 직전 20일 실현변동성 × k)하고,
      실제 TIGER200커버드콜(289480) 총수익 ÷ KODEX200 총수익(수정주가)과 합성 결과 ÷ 지수 가격을 맞추는 k를 찾는다. 기간은 상품 분배 이력 시작월~2026-09.
한계: (1) 실제 상품은 옵션 비중·행사가·롤 규칙이 완전히 같지 않다(구조 불확실). (2) 지수 배당(연 약 2%)은 합성 쪽에 없어 실제/합성 비교가 약간 어긋난다. (3) 상품 하나·한국 강세장 한 구간의 단일 추정이라 오차가 크다.
참고: 미국은 VIX÷직전 실현변동성 중앙값 1.39에 체결 보정 0.9를 곱한 약 1.25가 실제 QYLD와 맞았다.
"""
import json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_income_then_growth import monthly  # noqa: E402
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
rows = json.load(open(".research-cache/kospi.json", encoding="utf-8")); rows.sort(key=lambda r: r[0])
dates = [r[0] for r in rows]; px = np.array([float(r[1]) for r in rows]); lr = np.diff(np.log(px)); N = len(px)
R_F = 0.03
def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def bs(sig, T, otm):
    K = 1 + otm
    if sig <= 0 or T <= 0: return max(1 - K, 0)
    d1 = (math.log(1 / K) + (R_F + sig * sig / 2) * T) / (sig * math.sqrt(T)); d2 = d1 - sig * math.sqrt(T)
    return ncdf(d1) - K * math.exp(-R_F * T) * ncdf(d2)
def synth(i0, i1, step, c, otm, k):
    cur = 1.0; i = i0
    while i < i1:
        j = min(i + step, i1)
        vol = max(0.10, lr[max(0, i - 20):i].std() * math.sqrt(252) * k) if i >= 5 else 0.20
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
    for k in np.arange(0.6, 2.01, 0.05):
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
    print("   합성(지수 가격 대비) k=" + ", ".join(f"{k:.1f}:{r:.2f}" for k, r in out[::4]))
    print(f"   → 실제와 가장 가까운 k = {best[0]:.2f} (합성 {best[1]:.2f})" + (f", 보간 교차 k ≈ {cross:.2f}" if cross else ", 범위 안에서 교차 없음"))
