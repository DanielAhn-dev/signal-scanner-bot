# -*- coding: utf-8 -*-
"""
H21 해외 직접 보유분 매년 250만원 공제 활용(이익 실현 후 재매수) 검증 (2026-10-07).
가설: 매년 말 양도차익 250만원 한도까지 팔았다가 바로 다시 사면(취득가를 올리면) 10년 뒤 일괄 매도보다 세후 끝자산이 많다.
전략 A: 10년 보유 후 일괄 매도. 세금 = 22% × (양도차익 - 250만).
전략 B: 매 12개월째 말(평가 이익이 있으면) 이익 250만원어치만 실현(공제 안이라 세금 0)하고 같은 금액으로 재매수(취득가 상승), 마지막에 일괄 매도(그 해 공제 250만 적용).
세금 모형: 해외주식 양도소득세 22%(지방소득세 포함), 연 250만원 기본공제, 이동평균법 취득가, 환율 반영 원화 기준 손익.
비용: 매도·매수 각각 수수료율 c(기본 0.25%) — 매도 대금과 재매수 대금 모두에 부과. 환전은 달러로 보유해 재매수하므로 반영하지 않음.
데이터: SPY 월말 수정종가 + 원/달러 월말 (allweather/us_SPY.json·us_KRW_X.json, 2003-12~2026-09). 월 적립(연 총액 균등).
판정 기준(사전 고정): 연 1,000만원 월 적립·10년·수수료 0.25%에서, 차이(B-A)가 양수인 시작월이 90% 이상이면 안내 채택.
한계: 겹치는 창이라 독립 표본이 적고 강세장 위주(2003~). 배당 원천징수·금융소득종합과세 미반영(양쪽 같음). 손실 이월·상계 미반영. 부부는 1인당 공제라 금액을 반으로 나눠 보면 같다.
"""
import json, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
R = ".research-cache/allweather/"
spy = json.load(open(R + "us_SPY.json")); fx = json.load(open(R + "us_KRW_X.json"))
def monthly(rows, col):
    m = {}
    for r in rows:
        m[r[0][:6]] = r[col]
    return m
sp = monthly(spy, 1); kw = monthly(fx, 1)
months = sorted(m for m in sp if m in kw and m >= "200312")
px = np.array([sp[m] * kw[m] for m in months])  # 원화 환산 지수(수정종가 기준)
DED = 250.0  # 만원
TAX = 0.22


def run(start, years, yearly, cost, harvest):
    H = years * 12
    c_month = yearly / 12
    shares = 0.0   # 원화환산 지수 기준 주식 수(단위: 지수 1당)
    basis = 0.0    # 만원
    paid = 0.0
    for i in range(H):
        p = px[start + i]
        # 월초 적립을 월말 가격 직전에 산다고 보고 i번째 가격으로 매수
        shares += c_month / p
        basis += c_month
        paid += c_month
        if harvest and (i + 1) % 12 == 0 and i + 1 < H:
            v = shares * p
            gain = v - basis
            if gain > 0:
                sell_gain = min(DED, gain)
                f = sell_gain / gain
                sold = f * v
                basis = basis * (1 - f) + sold  # 매도분은 재매수로 취득가가 현재가가 됨
                paid += sold * cost * 2         # 매도 + 재매수 수수료
    p = px[start + H - 1]
    v = shares * p
    gain = max(v - basis, 0)
    tax = TAX * max(gain - DED, 0)
    sale_fee = v * cost
    return v - tax - sale_fee, paid


def compare(years, yearly, cost):
    n = len(px) - years * 12 + 1
    d = []
    for s in range(n):
        a, pa = run(s, years, yearly, cost, False)
        b, pb = run(s, years, yearly, cost, True)
        d.append((b - (pb - pa) - a))  # B 끝자산에서 추가 수수료 차감(수수료는 끝자산에서 별도 차감해 같은 단위로 비교)
    return np.array(d)


print(f"SPY(원화 환산) {months[0]}~{months[-1]} ({len(months)}개월)")
for yearly in (1000, 2000, 3000):
    print(f"\n[연 {yearly}만원 월 적립, 10년]")
    print(f"{'수수료':>6s} {'시작수':>6s} {'차이 중앙(만원)':>14s} {'나쁜10%':>9s} {'최소':>8s} {'최대':>8s} {'양수 비율':>8s}")
    for cost in (0.001, 0.0025, 0.005):
        d = compare(10, yearly, cost)
        print(f"{cost*100:>5.2f}% {len(d):>6d} {np.median(d):>14.1f} {np.percentile(d,10):>9.1f} {d.min():>8.1f} {d.max():>8.1f} {(d>0).mean()*100:>7.0f}%")
print("\n[연 1000만원, 수수료 0.25%, 보유 기간별]")
for years in (5, 10, 15, 20):
    d = compare(years, 1000, 0.0025)
    print(f"{years:>3d}년 시작 {len(d):>4d} 중앙 {np.median(d):>7.1f}만원 나쁜10% {np.percentile(d,10):>7.1f} 양수 {(d>0).mean()*100:>4.0f}%")
