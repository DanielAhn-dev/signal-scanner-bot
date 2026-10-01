# -*- coding: utf-8 -*-
"""
적립 + 여유자금 '하락 시 비중 확대' 검증 (2026-10-01). 코스피 1996~ 일봉, 현금 연3%.
같은 총납입(매월 1.5)을 두 방식으로 비교한다:
  전액적립  : 매월 1.5를 월초에 전부 투입
  기본+예비 : 매월 1.0 투입, 0.5는 예비금(현금)으로 쌓고, 250일 고점 대비 -X% 이하이면 예비금 전부 투입.
              예비금이 한도(월납입 N개월분)를 넘으면 하락이 없어도 투입(영원히 기다리지 않도록).
평가: 10년 후 (평가금+남은 예비금) / 총납입, 모든 월 시작점. 일시금 비교는 validate_index_timing.py 참고.
"""
import sys
import numpy as np
import validate_index_timing as t

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
c, MF, RC = t.c, t.MF, t.RC
first = set(MF)


def run(s, e, mode, dd=0.10, cap=6.0):
    cash, units, paid = 0.0, 0.0, 0.0
    reserve = 0.0
    for i in range(s, e + 1):
        cash *= 1 + RC
        reserve *= 1 + RC
        if i in first:
            paid += 1.5
            if mode == "all":
                units += 1.5 / c[i]
            else:
                units += 1.0 / c[i]
                reserve += 0.5
        if mode == "reserve" and reserve > 0:
            hi = c[max(0, i - 250):i + 1].max()
            if c[i] <= hi * (1 - dd) or reserve >= cap:
                units += reserve / c[i]
                reserve = 0.0
    return (units * c[e] + reserve) / paid


def summary(label, mode, **kw):
    res = []
    starts = [m for m in MF if m >= 250 and m + 2500 < t.N]
    for s in starts:
        res.append(run(s, s + 2500, mode, **kw))
    return np.array(res), label


for lo, hi, name in [(0, 99999999, "전체"), (0, 20081231, "1997~2008 시작"), (20090101, 99999999, "2009 이후 시작")]:
    starts = [m for m in MF if m >= 250 and m + 2500 < t.N and lo <= int(t.dates[m]) <= hi]
    base = np.array([run(s, s + 2500, "all") for s in starts])
    print(f"\n[{name}] 시작점 {len(starts)}개 — 총납입 대비 10년 후 배율")
    print(f"{'방식':28s} {'중앙값':>7s} {'하위10%':>8s} {'최악':>6s} {'전액적립 대비 승률':>16s}")
    print(f"{'전액적립(매월 1.5)':28s} {np.median(base):7.3f} {np.percentile(base,10):8.3f} {base.min():6.3f}")
    for dd in (0.10, 0.20):
        for cap in (6.0, 12.0):
            a = np.array([run(s, s + 2500, "reserve", dd=dd, cap=cap) for s in starts])
            print(f"{f'예비금 -{int(dd*100)}% 한도{int(cap/0.5)}개월':28s} {np.median(a):7.3f} {np.percentile(a,10):8.3f} {a.min():6.3f} {np.mean(a>base)*100:15.0f}%")
