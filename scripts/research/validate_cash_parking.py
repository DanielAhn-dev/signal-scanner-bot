# -*- coding: utf-8 -*-
"""
H23 현금 파킹(CD금리·KOFR·머니마켓·단기채 ETF)이 증권사 예수금·CMA보다 세후 연 1%p 이상 높은가 (2026-10-07).
데이터: 네이버 일봉 수정주가(보수 차감 후 NAV 기준, 분배금 소급 반영) + ECOS CD91. 기준일 최근 3년(2023-10-07~2026-10-07).
세금: ETF(채권형·머니마켓)의 분배금·매매차익도 배당소득 15.4%, CMA·예금 이자도 15.4% → 세율 같음, 세후 격차 = 세전 격차 × 0.846.
비교 대상 금리는 확인된 값이 없어 구간으로 둔다: 예수금(이용료 0~0.5% 가정), CMA 수시입출금·발행어음 2.0~2.5%, RP 최대 3.0%(2026-01 기사 요약, 증권사별로 다르고 수시 변동·우대 조건 있음).
판정 기준(사전 고정): ETF 세후 3년 연수익이 예수금 대비 +1%p 이상이고 CMA(2.5% 가정) 대비도 +1%p 이상이며, 일일 최대 하락이 -0.1%보다 얕으면 '대기 현금' 안내 채택. 예수금에만 앞서고 CMA에 못 미치면 '예수금 방치만 피하라'로 한정.
한계: 매매 스프레드·체결 비용은 호가 자료가 없어 왕복 0.02~0.1%로 가정. CMA 금리는 변동 큼. ETF 일 최대 하락은 NAV 기준이라 장중 괴리는 제외.
"""
import json, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding="utf-8")
R = ".research-cache/allweather/"
CODES = {"459580": "KODEX CD금리액티브", "357870": "TIGER CD금리투자KIS", "438100": "ACE CD금리액티브", "449170": "TIGER KOFR금리액티브",
         "423160": "KODEX KOFR금리액티브", "455890": "RISE 머니마켓액티브", "153130": "KODEX 단기채권", "214980": "KODEX 단기채권PLUS", "329750": "TIGER 단기통안채"}
cd = {r[0]: r[1] for r in json.load(open(R + "cd91.json"))}
cd_dates = sorted(cd)
print(f"CD91 {cd_dates[0]}~{cd_dates[-1]}")
END = "20261007"
# 중앙값에서 제외: ACE CD금리액티브(NAV 이상치: 일 -2.7%·3년 12.7%, 데이터 오류 의심), TIGER 단기통안채(듀레이션 있어 일 -2.2%, 파킹 용도 아님)
EXCLUDE = {"438100", "329750"}


def stats(rows, start):
    rows = [r for r in rows if r[0] >= start]
    d0, p0 = rows[0]; d1, p1 = rows[-1]
    days = (np.datetime64(f"{d1[:4]}-{d1[4:6]}-{d1[6:]}") - np.datetime64(f"{d0[:4]}-{d0[4:6]}-{d0[6:]}")).astype(int)
    cagr = (p1 / p0) ** (365 / days) - 1
    px = np.array([r[1] for r in rows])
    daily = px[1:] / px[:-1] - 1
    return cagr * 100, daily.min() * 100, d0, days / 365, (daily < -0.0005).sum()


def cd_avg(start):
    v = [cd[d] for d in cd_dates if d >= start]
    return float(np.mean(v)) if v else float('nan')


for label, start in (("최근 3년", "20231008"), ("최근 1년", "20251008")):
    print(f"\n=== {label} (시작 {start}) ===  CD91 평균 {cd_avg(start):.2f}% (자료 끝 {cd_dates[-1]})")
    print(f"{'ETF':24s} {'세전 연수익':>10s} {'세후':>7s} {'일 최대하락':>10s} {'-0.05%↓일수':>10s} {'시작일':>9s}")
    res = {}
    for c, n in CODES.items():
        rows = json.load(open(R + f"kr_{c}.json"))
        if rows[0][0] > start:
            print(f"{n:24s} (상장 {rows[0][0]}, 이 기간 자료 없음)")
            continue
        cg, mn, d0, yrs, nb = stats(rows, start)
        if c not in EXCLUDE:
            res[c] = cg
        print(f"{n:24s} {cg:>9.2f}% {cg*0.846:>6.2f}% {mn:>9.3f}% {nb:>10d} {d0:>9s}")
    if res:
        best = max(res.values()); med = float(np.median(list(res.values())))
        print(f"  파킹 ETF 7종(ACE CD·통안채 제외) 중앙 세전 {med:.2f}% / 세후 {med*0.846:.2f}%")
        print(f"  비교(세후 격차 = 0.846×(ETF 세전 − 상대 금리)): 상대 금리 0.5%(예수금 상단) → {0.846*(med-0.5):+.2f}%p, CMA 2.0% → {0.846*(med-2.0):+.2f}%p, CMA 2.5% → {0.846*(med-2.5):+.2f}%p, RP 3.0% → {0.846*(med-3.0):+.2f}%p")
        for sp in (0.0002, 0.001):
            print(f"    왕복 스프레드 {sp*100:.2f}% 보유 1개월 환산 연 {sp*12*100:.2f}%p 손실 / 6개월 {sp*2*100:.2f}%p / 1년 {sp*100:.2f}%p")
