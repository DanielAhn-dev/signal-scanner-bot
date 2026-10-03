# -*- coding: utf-8 -*-
"""
확인 빈도와 '아픈 순간'의 횟수 (2026-10-03).

질문: 같은 자산을 같은 기간 들고 있어도 얼마나 자주 보느냐에 따라 '지금 원금 아래'나 '-10%'를 마주치는 횟수가 달라지나?
      (결과는 안 바뀐다 — 보유 경로는 같다. 바뀌는 건 경험하는 불안의 빈도뿐이다. 이 크기를 재 본다.)
방법: 3년 보유(일시금) 창을 모든 시작일에서 시작해, 확인 주기(매일/주/월/분기/반기/연)마다
      (a) 확인한 날 중 매수 원금 아래인 비율 (b) 확인한 날 중 -10% 이하인 비율 (c) 3년 중 한 번이라도 -10% 이하를 본 비율
      (d) 3년 동안 '원금 아래'를 본 확인 횟수(중앙값·나쁜 10%).
데이터: 코스피 일별 가격지수 1996~(.research-cache/kospi.json), S&P500 일별 가격 1970~(.research-cache/allweather/us__GSPC.json, 종가). 배당 제외 —
        표시되는 평가손익을 가격으로 보는 경우(대부분의 증권 앱)와 같다. 거래일 기준(주=5·월=21·분기=63·반기=126·연=252거래일).
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_long_run import R  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HOLD = 252 * 3
FREQS = [("매일", 1), ("주 1회", 5), ("월 1회", 21), ("분기 1회", 63), ("반기 1회", 126), ("연 1회", 252)]


def load_kospi():
    rows = json.load(open(R + "kospi.json", encoding="utf-8"))
    rows.sort(key=lambda r: r[0])
    return np.array([float(r[1]) for r in rows])


def load_spx():
    rows = json.load(open(R + "allweather/us__GSPC.json", encoding="utf-8"))
    rows.sort(key=lambda r: r[0])
    return np.array([float(r[2]) for r in rows])


def study(name, px):
    n = len(px) - HOLD
    print(f"\n=== {name} — 일시금 3년 보유, 시작일 {n}개 ===")
    print(f"{'확인 주기':10s} {'원금 아래 본 비율':>16s} {'-10% 이하 본 비율':>16s} {'3년 중 -10% 본 적 있는 시작':>24s} {'원금 아래 본 횟수 중앙':>20s} {'나쁜10%':>8s}")
    # 일간 손익 행렬(시작일×경과일) — 메모리를 위해 시작일 간격 5일로 표본 추출
    starts = range(0, n, 5)
    paths = np.array([px[s + 1:s + HOLD + 1] / px[s] - 1 for s in starts])
    for label, step in FREQS:
        idx = np.arange(step - 1, HOLD, step)
        sub = paths[:, idx]
        below = sub < 0
        deep = sub <= -0.10
        cnt = below.sum(axis=1)
        print(f"{label:10s} {below.mean() * 100:15.0f}% {deep.mean() * 100:15.1f}% {deep.any(axis=1).mean() * 100:23.0f}% "
              f"{np.median(cnt):19.0f}회 {np.percentile(cnt, 90):7.0f}회   (확인 {len(idx)}번 중)")
    # 일 변동 자체의 크기: 하루 -2%, -3% 이상 하락한 날의 연간 평균 횟수
    d = px[1:] / px[:-1] - 1
    yrs = len(d) / 252
    print(f"하루 -2% 이하 하락: 연 {np.sum(d <= -0.02) / yrs:.1f}회, -3% 이하: 연 {np.sum(d <= -0.03) / yrs:.1f}회, -5% 이하: 연 {np.sum(d <= -0.05) / yrs:.2f}회 (전체 {len(d)}거래일)")


def main():
    study("코스피 1996~2026", load_kospi())
    study("S&P500 1970~2026", load_spx())


if __name__ == "__main__":
    main()
