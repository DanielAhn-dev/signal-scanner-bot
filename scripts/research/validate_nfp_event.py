# -*- coding: utf-8 -*-
"""
미국 NFP(비농업고용지표) 발표일이 코스피 매수 타이밍에 영향을 주는지 검증한다.
FOMC·CPI 검증(macroEventWarningService.ts 주석, 2026-09-29)과 같은 방법 — 차단일 매수 후
1·5·20일 수익을 평소와 비교(t-검정). 영향 없으면 지금처럼 차단 없이 "미검증" 표시만 "영향
없음(검증됨)"으로 바꾼다.

NFP 발표일 = BLS 관행상 "매월 첫째 금요일"(아주 가끔 노동절 등과 겹치면 둘째 금요일로 밀림).
정확한 역사적 예외 목록이 없어 규칙으로 생성한 근사치이지만, 29년×12개월 표본이라 몇 건의
날짜 오차는 결론에 영향 주지 않는다. 데이터: KOSPI(^KS11), .research-cache/kospi.json.
"""
import json
from datetime import date, timedelta

import numpy as np


def first_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    offset = (4 - d.weekday()) % 7  # Friday=4
    d = d + timedelta(days=offset)
    return d


def nfp_dates(start_year: int, end_year: int) -> list[str]:
    out = []
    for y in range(start_year, end_year + 1):
        for m in range(1, 13):
            if y == end_year and m > 10:  # 2026-10 이후는 아직 지나지 않음
                break
            out.append(first_friday(y, m).strftime("%Y%m%d"))
    return out


def main():
    rows = json.load(open(".research-cache/kospi.json", encoding="utf-8"))
    dates = [r[0] for r in rows]
    closes = np.array([r[1] for r in rows])
    idx = {d: i for i, d in enumerate(dates)}
    sorted_dates = dates

    events = nfp_dates(1997, 2026)
    events = [e for e in events if sorted_dates[0] <= e <= sorted_dates[-1]]

    def nearest_trading_idx(target: str) -> int | None:
        # target 이후 첫 거래일 (주말/휴장 보정)
        import bisect
        pos = bisect.bisect_left(sorted_dates, target)
        return pos if pos < len(sorted_dates) else None

    def fwd_return(i: int, n: int) -> float | None:
        if i is None or i + n >= len(closes) or closes[i] == 0:
            return None
        return closes[i + n] / closes[i] - 1

    all_1, all_5, all_20 = [], [], []
    for i in range(len(closes) - 20):
        all_1.append(closes[i + 1] / closes[i] - 1)
        all_5.append(closes[i + 5] / closes[i] - 1)
        all_20.append(closes[i + 20] / closes[i] - 1)
    all_1, all_5, all_20 = np.array(all_1), np.array(all_5), np.array(all_20)

    ev_1, ev_5, ev_20 = [], [], []
    n_matched = 0
    for e in events:
        i = nearest_trading_idx(e)
        if i is None:
            continue
        n_matched += 1
        r1, r5, r20 = fwd_return(i, 1), fwd_return(i, 5), fwd_return(i, 20)
        if r1 is not None:
            ev_1.append(r1)
        if r5 is not None:
            ev_5.append(r5)
        if r20 is not None:
            ev_20.append(r20)

    def ttest(sample: np.ndarray, pop_mean: float, pop_std: float) -> tuple[float, float]:
        n = len(sample)
        se = pop_std / np.sqrt(n)
        t = (sample.mean() - pop_mean) / se
        return sample.mean(), t

    print(f"NFP 발표일(근사) {len(events)}건 중 거래일 매칭 {n_matched}건, 코스피 1996-12~2026-10")
    print(f"{'구간':6s} {'표본':>5s} {'NFP일 평균':>12s} {'평소 평균':>10s} {'t값':>8s}")
    for label, ev, allr, n in (("1일", ev_1, all_1, 1), ("5일", ev_5, all_5, 5), ("20일", ev_20, all_20, 20)):
        ev = np.array(ev)
        m, t = ttest(ev, allr.mean(), allr.std())
        print(f"{label:6s} {len(ev):5d} {m*100:11.2f}% {allr.mean()*100:9.2f}% {t:8.2f}")


if __name__ == "__main__":
    main()
