# -*- coding: utf-8 -*-
"""
N1 해외 지수 ETF: 국내 상장(배당소득세 15.4%, 매매차익도 15.4%) vs 해외 직접 보유(양도세 22%, 연 250만원 공제, 배당 원천 15%) 세후 비교 (2026-10-07).
같은 지수(S&P500, 원화 환산·총수익)를 매월 같은 금액 적립, 보유 기간 끝에 전량 매도해 세후 끝자산을 비교.
전략: A 국내 상장 / B 직접 보유(끝에 일괄 매도) / C 직접 보유 + 매년 말 250만원 실현·재매수(H21).
세금 모형: A 분배금 15.4%·매매차익 15.4%(실제 이익 기준, 과표기준가 규정은 단순화), B·C 분배금 15%·양도차익 22%×(차익−250만, 연 1인),
 국내 상장 분배금과 직접 보유 분배금 비율은 같다고 둠(분배 1.3%). 보수(총보수) 차이는 반영하지 않음(둘 다 NAV/수정종가에 이미 포함되어 비슷하다고 가정).
비용(편도, 가정): A 0.03%(수수료·호가), B·C 0.15% 또는 0.30%(해외 수수료+환전 스프레드, 우대 여부에 따라 달라짐).
사전 판정 기준(결과 보기 전 고정): 연 1,000만원 월 적립·10년·비용 0.30%에서 직접이 국내 상장보다 세후 끝자산이 큰 시작월이 90% 이상이면 '직접 우위', 10% 이하면 '국내 상장 우위', 그 사이면 '규모·조건에 따라 달라짐'.
추가로 이익 규모별 손익분기(단일 매도 기준)와 금융소득종합과세·건보료는 반영하지 않음(국내 상장 쪽이 불리해지는 요인이라 별도 안내).
데이터: SPY 월말 수정종가 × 원/달러 (allweather/us_SPY.json·us_KRW_X.json, 2003-12~2026-09).
"""
import json, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
R = ".research-cache/allweather/"
def monthly(rows):
    m = {}
    for r in rows: m[r[0][:6]] = r[1]
    return m
sp, kw = monthly(json.load(open(R + "us_SPY.json"))), monthly(json.load(open(R + "us_KRW_X.json")))
ms = [m for m in sorted(sp) if m in kw and m >= "200312"]
px = np.array([sp[m] * kw[m] for m in ms])
DED, T_DOM, T_DIR, T_DIV_US = 250.0, 0.154, 0.22, 0.15
DIST = 0.013


def run(start, years, yearly, strat, cost):
    H = years * 12
    c = yearly / 12
    v = 0.0; basis = 0.0
    div_tax = T_DOM if strat == "A" else T_DIV_US
    fee_in = 0.0003 if strat == "A" else cost
    fee_out = 0.0003 if strat == "A" else cost
    for i in range(H):
        p_prev = px[start + i - 1] if (start + i) > 0 else px[start + i]
        r = px[start + i] / p_prev - 1 if i > 0 or start > 0 else 0.0
        buy = c * (1 - fee_in)
        # 월초 적립 후 한 달 수익
        v += buy; basis += c
        price_r = r - DIST / 12
        dist = v * DIST / 12
        v = v * (1 + price_r) + dist * (1 - div_tax)
        basis += dist * (1 - div_tax)
        if strat == "C" and (i + 1) % 12 == 0 and i + 1 < H:
            gain = v - basis
            if gain > 0:
                f = min(DED, gain) / gain
                sold = f * v
                basis = basis * (1 - f) + sold
                v -= sold * fee_out * 2   # 매도·재매수 비용
    gain = max(v - basis, 0)
    sale_fee = v * fee_out
    tax = (T_DOM * gain) if strat == "A" else T_DIR * max(gain - DED, 0)
    return v - sale_fee - tax


def compare(years, yearly, cost):
    n = len(px) - years * 12
    out = []
    for s in range(1, n + 1):
        a = run(s, years, yearly, "A", cost)
        b = run(s, years, yearly, "B", cost)
        c = run(s, years, yearly, "C", cost)
        out.append((b - a, c - a, a))
    return np.array(out)


print(f"SPY(원화) {ms[0]}~{ms[-1]}, 분배 {DIST*100:.1f}%")
for cost in (0.0015, 0.0030):
    for yearly in (600, 1000, 3000):
        d = compare(10, yearly, cost)
        print(f"\n[10년 · 연 {yearly}만원 · 직접 편도 {cost*100:.2f}%] 시작월 {len(d)}")
        for name, k in (("B 직접(일괄 매도)", 0), ("C 직접(연말 250만 실현)", 1)):
            x = d[:, k]
            print(f"  {name:22s} 국내 대비 중앙 {np.median(x):>8.1f}만원({np.median(x/d[:,2])*100:+.2f}%)  나쁜10% {np.percentile(x,10):>7.1f}  좋은10% {np.percentile(x,90):>7.1f}  직접이 앞선 비율 {(x>0).mean()*100:>4.0f}%")
print("\n[보유 기간별 · 연 1,000만 · 편도 0.30%] C 직접(연말 실현) 국내 대비")
for years in (5, 10, 15, 20):
    d = compare(years, 1000, 0.0030)
    print(f"  {years:>2d}년 중앙 {np.median(d[:,1]):>8.1f}만원 앞선 비율 {(d[:,1]>0).mean()*100:>4.0f}%  / B: 중앙 {np.median(d[:,0]):>8.1f} 앞선 {(d[:,0]>0).mean()*100:>4.0f}%")

print("\n[손익분기 · 한 번에 매도할 때 이익 규모] 세금만 비교(비용 제외)")
for g in (100, 300, 500, 833, 1000, 3000, 10000):
    a = T_DOM * g
    b = T_DIR * max(g - DED, 0)
    print(f"  이익 {g:>6d}만원: 국내 {a:>7.1f} / 직접 {b:>7.1f} → {'직접 유리' if b < a else ('같음' if abs(a-b)<0.5 else '국내 유리')} (차이 {a-b:+.1f}만원)")
