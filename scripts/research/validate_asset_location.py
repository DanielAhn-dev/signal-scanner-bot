# -*- coding: utf-8 -*-
"""
H18 자산 위치 검증 (2026-10-07). 같은 돈·같은 비중에서 어느 자산을 어느 계좌에 담느냐가 세후 끝자산을 바꾸나?

배치 A: 연금계좌(연금저축·IRP)=미국 S&P500(원화), 일반계좌=코스피200   (가설의 '권장' 배치)
배치 B: 연금계좌=코스피200, 일반계좌=미국 S&P500                       (반대)
세전 경로는 두 배치가 같다(매월 두 계좌에 같은 금액 적립). 세금만 다르다.
세금 가정(국내 상장 ETF, 일반계좌):
  코스피200 = 국내 주식형: 매매차익 비과세, 분배금만 15.4%.
  S&P500    = 국내 상장 해외 주식형: 분배금과 매매차익 모두 15.4%(차익 = 평가액 - 취득가, 세후 분배 재투자분은 취득가에 합산).
연금계좌: 보유 중 과세이연, 끝에 평가액 전액을 연금소득세 5.5%로 수령(55~69세 가정).
세액공제 환급은 두 배치에서 같아 제외. 건보료·금융소득종합과세·ISA 미반영.
데이터: web/src/data/mixData.ts 월말 수정주가(분배 반영, 원화). 분배 비율은 가정(민감도로 변경).
판정 기준(사전 고정, 결과 보기 전): 10년 보유, 모든 시작월에서 (A-B)/B 의 중앙값 +1% 이상이고, 90% 이상의 시작월에서 A>B이면 채택.
"""
import json, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
txt = open("web/src/data/mixData.ts", encoding="utf-8").read()
j = txt[txt.index("= [{") + 2: txt.rindex("]") + 1]
assets = {a["id"]: dict((m, v) for m, v in a["monthly"]) for a in json.loads(j)}
k, u = assets["kospi200"], assets["sp500"]
ms = [m for m in sorted(k) if m in u]
rk = np.array([k[ms[i]] / k[ms[i - 1]] - 1 for i in range(1, len(ms))])
ru = np.array([u[ms[i]] / u[ms[i - 1]] - 1 for i in range(1, len(ms))])
T_DIV = 0.154
T_PEN = 0.055


def general(r, c, d, taxable_gain):
    """일반계좌에서 월 c씩 적립. 세후 끝자산 반환."""
    v = 0.0
    basis = 0.0
    for x in r:
        v += c
        basis += c
        price = x - d / 12
        dist = v * d / 12
        v = v * (1 + price) + dist * (1 - T_DIV)
        basis += dist * (1 - T_DIV)
    if taxable_gain:
        v -= max(v - basis, 0) * T_DIV
    return v


def pension(r, c):
    v = 0.0
    for x in r:
        v = (v + c) * (1 + x)
    return v * (1 - T_PEN)


def run(H, dk, du):
    n = len(rk)
    out = []
    for s in range(n - H + 1):
        a_kr, a_us = rk[s:s + H], ru[s:s + H]
        A = pension(a_us, 1) + general(a_kr, 1, dk, False)
        B = pension(a_kr, 1) + general(a_us, 1, du, True)
        out.append((A - B) / B * 100)
    return np.array(out)


print(f"공통 {ms[0]}~{ms[-1]} ({len(rk)}개월)")
for dk, du in ((0.017, 0.015), (0.023, 0.015), (0.017, 0.0), (0.012, 0.015)):
    print(f"\n[분배 비율 가정] 코스피200 {dk*100:.1f}% / 미국 {du*100:.1f}%")
    print(f"{'기간':>5s} {'시작수':>6s} {'차이 중앙':>9s} {'나쁜10%':>8s} {'최소':>7s} {'최대':>7s} {'A>B 비율':>8s}")
    for H in (60, 120, 180, 240):
        d = run(H, dk, du)
        if len(d) == 0:
            continue
        print(f"{H//12:>4d}년 {len(d):>6d} {np.median(d):>8.2f}% {np.percentile(d,10):>7.2f}% {d.min():>6.2f}% {d.max():>6.2f}% {(d>0).mean()*100:>7.0f}%")

print("\n[손익분기 점검] 두 자산 모두 연 g로 일정하게 오르는 가상 경로(분배 1.7%/1.5%), 월 적립")
print(f"{'g':>5s} " + " ".join(f"{H//12:>2d}년차이" for H in (60, 120, 240)))
for g in (0.0, 0.01, 0.02, 0.03, 0.04, 0.06, 0.08, 0.10):
    m = (1 + g) ** (1 / 12) - 1
    row = []
    for H in (60, 120, 240):
        r = np.full(H, m)
        A = pension(r, 1) + general(r, 1, 0.017, False)
        B = pension(r, 1) + general(r, 1, 0.015, True)
        row.append((A - B) / B * 100)
    print(f"{g*100:>4.0f}% " + " ".join(f"{x:>7.2f}%" for x in row))
