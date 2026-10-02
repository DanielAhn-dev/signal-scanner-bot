# -*- coding: utf-8 -*-
"""
KODEX 200 정액 적립 롤링 시뮬레이션 (2026-10-02): 얼마를 넣으면 몇 년 뒤 어떤 결과였나.

가격: 네이버 수정주가(분배금 소급 반영 = 세전 재투자 수익, 2002-10~). TR 상품은 이 값과 같은 성격이다.
방법: 모든 월(또는 주·일) 시작점에서 매 회 동일 금액을 적립하고 horizon 뒤 평가금 / 총납입을 본다.
미래 예측이 아니라 "과거에 그렇게 했다면"의 분포다. 시작점이 겹쳐 독립 표본 수는 적다(특히 15년).
"""
import json
import numpy as np

px = sorted(json.load(open(".research-cache/index_etfs/px_069500.json", encoding="utf-8")))
dates = [d for d, _ in px]
close = np.array([c for _, c in px], dtype=float)


def pick_days(freq: str) -> list[int]:
    idx, last = [], None
    for i, d in enumerate(dates):
        key = d[:6] if freq == "month" else (d[:4] + str(__import__("datetime").date(int(d[:4]), int(d[4:6]), int(d[6:])).isocalendar()[1]) if freq == "week" else d)
        if key != last:
            idx.append(i)
            last = key
    return idx


def rolling(freq: str, years: int):
    days = pick_days(freq)
    out = []
    end_off = years * 12 if freq == "month" else (years * 52 if freq == "week" else years * 245)
    for s in range(0, len(days) - end_off):
        buys = days[s:s + end_off]
        end = days[s + end_off] if s + end_off < len(days) else len(close) - 1
        units = sum(1.0 / close[i] for i in buys)
        out.append(units * close[end] / len(buys))
    return np.array(out)


if __name__ == "__main__":
    print(f"가격 {dates[0]}~{dates[-1]}  {len(dates)}일")
    print("\n[월 적립] 총납입 대비 평가배율 (1.0=원금)")
    print(f"{'기간':>5}{'시작점':>7}{'최악':>7}{'하위10%':>8}{'중앙값':>8}{'상위10%':>8}{'원금손실확률':>10}{'+20%이상':>9}{'+50%이상':>9}")
    for y in (1, 2, 3, 5, 7, 10, 15):
        r = rolling("month", y)
        print(f"{y:>4}년{len(r):7d}{r.min():7.2f}{np.percentile(r,10):8.2f}{np.median(r):8.2f}{np.percentile(r,90):8.2f}{(r<1).mean()*100:9.0f}%{(r>=1.2).mean()*100:8.0f}%{(r>=1.5).mean()*100:8.0f}%")
    print("\n[주기 비교] 5년 보유, 같은 총납입 (월/주/일 적립 중앙값·하위10%)")
    for f, n in (("month", "월 1회"), ("week", "주 1회"), ("day", "매일")):
        r = rolling(f, 5)
        print(f"  {n:6} 중앙값 {np.median(r):.3f}  하위10% {np.percentile(r,10):.3f}  최악 {r.min():.3f}")
    print("\n[월 적립 금액별 5년 뒤 평가금 (중앙값 / 하위10% / 최악), 원 단위]")
    r5 = rolling("month", 5)
    for m in (100_000, 300_000, 500_000, 1_000_000):
        paid = m * 60
        print(f"  월 {m:>9,}원  납입 {paid:>12,.0f}  →  {paid*np.median(r5):>12,.0f} / {paid*np.percentile(r5,10):>12,.0f} / {paid*r5.min():>12,.0f}")
    # 원금 회복(평가금>=납입) 걸리는 개월: 시작점별
    days = pick_days("month")
    rec = []
    for s in range(len(days) - 1):
        units = 0.0; n = 0
        for k in range(s, len(days)):
            units += 1.0 / close[days[k]]; n += 1
            if n >= 6 and units * close[days[k]] / n >= 1.2:
                rec.append(n); break
    rec = np.array(rec)
    print(f"\n[+20% 수익에 처음 도달까지 걸린 개월] 도달한 시작점 {len(rec)}/{len(days)-1}  중앙값 {np.median(rec):.0f}개월  하위25% {np.percentile(rec,25):.0f}  상위25% {np.percentile(rec,75):.0f}  최대 {rec.max()}")
