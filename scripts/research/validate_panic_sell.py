# -*- coding: utf-8 -*-
"""
행동 격차 검증 (2026-10-02): 하락 중에 팔았다가 다시 산 사람 vs 계속 보유한 사람.

데이터: KODEX200(069500) 일봉 수정주가(2002-10~, 분배금 반영) + CD91 금리(현금 수익), .research-cache/
시작점: 모든 월 첫 거래일, 보유 기간 5년·10년 (자기 이력 안에서 가능한 모든 시작점).
규칙(감정이 아니라 기계적으로 정의한 "패닉 매도자"):
  - 보유 중 고점(시작 이후 최고 종가) 대비 -20% 종가에 닿으면 그다음 거래일 종가에 전량 매도, 현금(CD91 금리)으로 보관.
  - 재진입 3가지: (A) 매도 6개월 뒤 (B) 저점에서 +20% 반등을 확인한 날 다음 거래일 (C) 직전 고점을 회복한 날 다음 거래일.
  - 한 번 재진입하면 같은 규칙이 다시 적용된다(고점은 재진입 후 가격부터 다시 잡음).
비용·세금은 넣지 않았다(매도 때문에 늘어나는 거래비용과 세금은 패닉 매도자에게 더 불리하다).
출력: 시작점 수, 보유 대비 배율의 중앙값, 패닉 매도자가 보유보다 나은 비율, 최악 격차, 매도가 실제로 도움이 된 시작점의 대표 사례.
"""
import json
import sys

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
ROOT = ".research-cache/"
TRIGGER = -0.20
REBOUND = 0.20


def load():
    px = sorted(json.load(open(ROOT + "px_069500.json", encoding="utf-8")))
    dates = [d for d, _ in px]
    close = np.array([float(c) for _, c in px])
    cd = {d: v for d, v in json.load(open(ROOT + "allweather/cd91.json", encoding="utf-8"))}
    cds = sorted(cd)
    rate, j, last = [], 0, 3.0
    for d in dates:
        while j < len(cds) and cds[j] <= d:
            last = cd[cds[j]]
            j += 1
        rate.append(last)
    cash_daily = (1 + np.array(rate) / 100) ** (1 / 250) - 1
    return dates, close, cash_daily


def simulate(close, cash, i0, i1, reentry):
    """i0에서 전액 매수해 i1까지. reentry: 'A'|'B'|'C'|'hold'. 최종 평가배율과 매도 횟수 반환."""
    if reentry == "hold":
        return close[i1] / close[i0], 0
    value = 1.0
    in_mkt = True
    peak = close[i0]
    low = None
    prior_peak = None
    sold_i = None
    sells = 0
    i = i0
    while i < i1:
        nxt = i + 1
        if in_mkt:
            value *= close[nxt] / close[i]
            peak = max(peak, close[nxt])
            if close[nxt] / peak - 1 <= TRIGGER and nxt + 1 <= i1:
                # 다음 거래일 종가에 매도
                value *= close[nxt + 1] / close[nxt]
                nxt += 1
                in_mkt = False
                sells += 1
                prior_peak, low, sold_i = peak, close[nxt], nxt
        else:
            value *= 1 + cash[nxt]
            low = min(low, close[nxt])
            go = False
            if reentry == "A":
                go = nxt - sold_i >= 125
            elif reentry == "B":
                go = close[nxt] / low - 1 >= REBOUND
            elif reentry == "C":
                go = close[nxt] >= prior_peak
            if go and nxt + 1 <= i1:
                value *= 1 + cash[nxt + 1]
                nxt += 1
                in_mkt = True
                peak = close[nxt]
        i = nxt
    return value, sells


def main():
    dates, close, cash = load()
    starts = [i for i in range(len(dates)) if i == 0 or dates[i][:6] != dates[i - 1][:6]]
    for years in (5, 10):
        n = years * 250
        rows = []
        for i0 in starts:
            i1 = i0 + n
            if i1 >= len(dates):
                continue
            h, _ = simulate(close, cash, i0, i1, "hold")
            res = {k: simulate(close, cash, i0, i1, k) for k in "ABC"}
            rows.append((dates[i0], h, res))
        print(f"\n=== {years}년 보유, 월별 시작점 {len(rows)}개 ({rows[0][0]}~{rows[-1][0]}) ===")
        touched = [r for r in rows if r[2]["A"][1] > 0]
        print(f"-20% 낙폭을 겪어 실제로 팔게 된 시작점: {len(touched)}개 ({len(touched) / len(rows) * 100:.0f}%)")
        print(f"{'재진입':32s} {'배율 중앙값':>8s} {'하위10%':>8s} {'보유보다 나은 비율':>16s} {'최악 격차':>8s} {'최고 격차':>8s}  (대상: 팔게 된 시작점)")
        base = np.array([r[1] for r in touched])
        print(f"{'계속 보유(같은 시작점)':32s} {np.median(base):8.2f} {np.percentile(base, 10):8.2f}")
        for k, label in (("A", "A. 6개월 뒤 다시 매수"), ("B", "B. 저점 +20% 확인 후 매수"), ("C", "C. 직전 고점 회복 후 매수")):
            v = np.array([r[2][k][0] for r in touched])
            ratio = v / base
            print(f"{label:32s} {np.median(v):8.2f} {np.percentile(v, 10):8.2f} {np.mean(v > base) * 100:15.0f}% {ratio.min():8.2f} {ratio.max():8.2f}")
        # 사례: 이득/손실이 가장 컸던 시작점 (B 기준)
        diffs = sorted(((r[2]["B"][0] / r[1], r[0]) for r in touched))
        print("B 기준 가장 나빴던 시작점:", [(d, round(x, 2)) for x, d in diffs[:3]])
        print("B 기준 가장 좋았던 시작점:", [(d, round(x, 2)) for x, d in diffs[-3:]])
        # 팔게 된 시작점 중 매도 후 +20% 반등 전에 더 빠진 비율(매도가 유효했던 경우)
        helped = np.mean([r[2]["B"][0] > r[1] for r in touched]) * 100
        print(f"B 기준 패닉 매도가 보유보다 나았던 비율: {helped:.0f}%")


if __name__ == "__main__":
    main()
