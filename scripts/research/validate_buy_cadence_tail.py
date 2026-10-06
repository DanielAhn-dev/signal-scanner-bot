# -*- coding: utf-8 -*-
"""
적립 간격(매일·매주·매달)의 "운 나쁜 경우"와 폭락 예언에 대한 데이터 점검 (2026-10-06).

사용자 질문: "매일 사면 평균인데, 매주(매달) 사면 혹시 비쌀 때만 사게 되는 것 아닌가?"
              "유명 트레이더가 S&P500 큰 하락을 예고한다. 근거가 있나? 그러면 언제 사야 하나?"
앞선 검증(validate_index_timing.py, 2026-10-01)은 적립 간격별 '중앙값'이 같다는 것까지였다.
여기서는 분포의 꼬리(하위 10%·최악)와, 하필 폭락 직전 고점에서 시작한 경우를 본다.

A. 적립 간격별 평단가 — 코스피 1996-12~2026-10 일별. 같은 기간·같은 월 예산으로
   매일(월 예산을 그달 거래일 수로 나눔) / 매주 요일별(월~금, 휴장이면 그 주 다음 거래일) / 매달(첫날·15일·말일).
   지표: 평단가 ÷ 매일 평단가 − 1 (양수 = 매일보다 비싸게 샀다). 시작월을 매달 바꿔 12·36·120개월 적립.
B. KODEX 200(069500) 실제 가격·1주 단위 — 월 44만원 수준: 매주 1주 vs 매달 첫 거래일 4주.
C. 폭락 직전 고점에서 매주 적립 시작 — 코스피 고점 대비 -30% 이상 하락 구간마다. 12·24·36개월 뒤
   적립금 대비 평가액, 도중 최대 평가손실, 같은 날 일시금과 비교.
D. 밸류에이션과 1년 내 폭락 — Shiller S&P 월별(1881~2023-09). CAPE 5분위별로 이후 12개월 안에
   시작가 대비 -20% 이하로 내려간 비율과 이후 10년 실질 총수익(연율).
한계: 거래비용·세금·분배금 제외(코스피는 가격지수). Shiller는 월 평균 가격이라 낙폭이 작게 나온다.
     Shiller 공개 파일은 2023-09까지라 '지금' CAPE는 여기서 말하지 않는다.
"""
import json
import sys
from datetime import date

import numpy as np
import xlrd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
R = ".research-cache/"


def load_px(name):
    rows = json.load(open(R + name, encoding="utf-8"))
    d = [date(int(s[:4]), int(s[4:6]), int(s[6:8])) for s, _ in rows]
    p = np.array([float(v) for _, v in rows])
    return d, p


def month_key(x):
    return x.year * 12 + x.month - 1


def schedules(dates):
    """날짜 인덱스별 각 방식의 매수 가중(같은 달 예산 1을 나눠 쓴다)."""
    n = len(dates)
    mk = np.array([month_key(x) for x in dates])
    out = {}
    # 매일
    w = np.zeros(n)
    for m in np.unique(mk):
        idx = np.where(mk == m)[0]
        w[idx] = 1.0 / len(idx)
    out["매일"] = w
    # 매주 요일별: ISO 주마다 요일 이상인 첫 거래일, 주당 금액 = 12/52
    iso = [x.isocalendar()[:2] for x in dates]
    for wd, label in enumerate(["월", "화", "수", "목", "금"]):
        w = np.zeros(n)
        i = 0
        while i < n:
            j = i
            while j < n and iso[j] == iso[i]:
                j += 1
            week = range(i, j)
            pick = next((k for k in week if dates[k].weekday() >= wd), j - 1)
            w[pick] += 12 / 52
            i = j
        out[f"매주 {label}"] = w
    # 매달
    for label, rule in [("매달 첫날", "first"), ("매달 15일", "mid"), ("매달 말일", "last")]:
        w = np.zeros(n)
        for m in np.unique(mk):
            idx = np.where(mk == m)[0]
            if rule == "first":
                k = idx[0]
            elif rule == "last":
                k = idx[-1]
            else:
                k = next((t for t in idx if dates[t].day >= 15), idx[-1])
            w[k] += 1.0
        out[label] = w
    return out, mk


def pct(a, q):
    return float(np.percentile(a, q))


def part_a():
    dates, p = load_px("kospi.json")
    sch, mk = schedules(dates)
    months = np.unique(mk)
    print("\n== A. 적립 간격별 평단가: 매일 대비 (+ = 더 비싸게 삼), 코스피 1996-12~2026-10")
    for H in (12, 36, 120):
        starts = [m for m in months if m + H - 1 <= months[-1]]
        res = {k: [] for k in sch if k != "매일"}
        weekday_spread = []
        for m in starts:
            sel = (mk >= m) & (mk <= m + H - 1)
            def avg_cost(w):
                ww = w[sel]
                return ww.sum() / (ww / p[sel]).sum()
            base = avg_cost(sch["매일"])
            vals = {}
            for k in res:
                v = (avg_cost(sch[k]) / base - 1) * 100
                res[k].append(v)
                vals[k] = v
            wk = [vals[k] for k in vals if k.startswith("매주")]
            weekday_spread.append(max(wk) - min(wk))
        print(f"\n  [{H}개월 적립, 시작 {len(starts)}회]  중앙값 / 하위10%(나쁜 쪽 90분위) / 최악 / 매일보다 1%p 넘게 비싼 비율")
        for k, v in res.items():
            a = np.array(v)
            print(f"   {k:8s} {np.median(a):+.2f}%  {pct(a, 90):+.2f}%  {a.max():+.2f}%  {np.mean(a > 1) * 100:4.1f}%")
        ws = np.array(weekday_spread)
        print(f"   요일을 '가장 나쁘게' 골랐을 때와 '가장 좋게' 골랐을 때 차이: 중앙값 {np.median(ws):.2f}%p, 90분위 {pct(ws, 90):.2f}%p, 최대 {ws.max():.2f}%p")


def part_b():
    dates, p = load_px("px_069500.json")
    mk = np.array([month_key(x) for x in dates])
    iso = [x.isocalendar()[:2] for x in dates]
    print("\n== B. KODEX 200 실제 가격·1주 단위 (2002-10~): 매주 1주(주 첫 거래일) vs 매달 첫 거래일 4주")
    for H in (12, 36, 120):
        months = np.unique(mk)
        starts = [m for m in months if m + H - 1 <= months[-1]]
        diffs = []
        for m in starts:
            sel = np.where((mk >= m) & (mk <= m + H - 1))[0]
            wk_cost = []
            seen = set()
            for k in sel:
                if iso[k] not in seen:
                    seen.add(iso[k])
                    wk_cost.append(p[k])
            mo_cost = []
            seen_m = set()
            for k in sel:
                if mk[k] not in seen_m:
                    seen_m.add(mk[k])
                    mo_cost += [p[k]] * 4
            diffs.append((np.mean(mo_cost) / np.mean(wk_cost) - 1) * 100)
        a = np.array(diffs)
        print(f"   {H:3d}개월: 매달 4주 평단 − 매주 1주 평단 = 중앙값 {np.median(a):+.2f}%, 10~90분위 {pct(a, 10):+.2f}%~{pct(a, 90):+.2f}%, 최악 {a.max():+.2f}% / 최선 {a.min():+.2f}%")


def part_c():
    dates, p = load_px("kospi.json")
    iso = [x.isocalendar()[:2] for x in dates]
    # 고점 대비 -30% 이상 하락한 구간의 고점
    peaks = []
    run_max_i = 0
    in_dd = False
    for i in range(len(p)):
        if p[i] > p[run_max_i]:
            run_max_i = i
            in_dd = False
        elif not in_dd and p[i] <= p[run_max_i] * 0.7:
            peaks.append(run_max_i)
            in_dd = True
    print("\n== C. 폭락 직전 고점에서 매주(주 첫 거래일) 같은 금액 적립을 시작했다면 — 코스피")
    print("   고점일       최대낙폭   | 12개월: 평가/적립  도중최저 | 24개월 | 36개월 | 일시금 36개월")
    for pk in peaks:
        # 이 하락 구간의 바닥: 고점을 다시 넘기 전까지의 최저
        rec = next((k for k in range(pk + 1, len(p)) if p[k] > p[pk]), len(p))
        mdd = (p[pk:rec].min() / p[pk] - 1) * 100
        cells = []
        for H in (12, 24, 36):
            end = next((k for k in range(pk, len(p)) if (dates[k] - dates[pk]).days >= H * 30.44), None)
            if end is None:
                cells.append("   (진행 중)        ")
                continue
            units = 0.0
            paid = 0.0
            worst = 0.0
            seen = set()
            for k in range(pk, end + 1):
                if iso[k] not in seen:
                    seen.add(iso[k])
                    units += 1 / p[k]
                    paid += 1
                worst = min(worst, units * p[k] / paid - 1)
            cells.append(f"{(units * p[end] / paid - 1) * 100:+6.1f}%  {worst * 100:+6.1f}%")
        end36 = next((k for k in range(pk, len(p)) if (dates[k] - dates[pk]).days >= 36 * 30.44), None)
        lump = f"{(p[end36] / p[pk] - 1) * 100:+6.1f}%" if end36 else "  -"
        print(f"   {dates[pk]}  {mdd:+6.1f}%  | " + " | ".join(cells) + f" | {lump}")


def part_d():
    sh = xlrd.open_workbook(R + "longrun/ie_data.xls").sheet_by_name("Data")
    P, CAPE, TR = [], [], []
    for r in range(8, sh.nrows):
        v = sh.cell_value(r, 0)
        if not isinstance(v, float):
            continue
        P.append(sh.cell_value(r, 1))
        c = sh.cell_value(r, 12)
        CAPE.append(c if isinstance(c, float) else np.nan)
        t = sh.cell_value(r, 9)
        TR.append(t if isinstance(t, float) else np.nan)
    P = np.array([x if isinstance(x, float) else np.nan for x in P])
    CAPE = np.array(CAPE)
    TR = np.array(TR)
    n = len(P)
    crash, fwd10, cape = [], [], []
    for i in range(n - 12):
        if np.isnan(CAPE[i]) or np.isnan(P[i]):
            continue
        crash.append(np.nanmin(P[i + 1:i + 13]) <= P[i] * 0.8)
        fwd10.append((TR[i + 120] / TR[i]) ** (1 / 10) - 1 if i + 120 < n and not np.isnan(TR[i + 120]) else np.nan)
        cape.append(CAPE[i])
    crash = np.array(crash)
    fwd10 = np.array(fwd10)
    cape = np.array(cape)
    qs = np.percentile(cape, [20, 40, 60, 80])
    print("\n== D. S&P500 밸류에이션(CAPE)과 이후 1년 내 -20% 하락·10년 실질 수익 (Shiller 월별, 1881~2023-09)")
    print(f"   전체: 12개월 안에 시작가 대비 -20% 이하로 내려간 달의 비율 {crash.mean() * 100:.1f}% (월 평균가 기준이라 실제보다 낮게 나온다)")
    lo = -np.inf
    for qi, hi in enumerate(list(qs) + [np.inf]):
        sel = (cape > lo) & (cape <= hi)
        f = fwd10[sel]
        f = f[~np.isnan(f)]
        label = f"CAPE {lo:5.1f}~{hi:5.1f}" if np.isfinite(lo) and np.isfinite(hi) else (f"CAPE ≤{hi:5.1f}" if np.isfinite(hi) else f"CAPE >{lo:5.1f}")
        print(f"   {qi + 1}분위 {label:18s}: 1년 내 -20% {crash[sel].mean() * 100:5.1f}%  · 이후 10년 실질 총수익 연 {np.median(f) * 100:+.1f}% (중앙값, 10% 분위 {pct(f, 10) * 100:+.1f}%)")
        lo = hi
    top = cape > np.percentile(cape, 90)
    print(f"   상위 10% (CAPE >{np.percentile(cape, 90):.1f}): 1년 내 -20% {crash[top].mean() * 100:.1f}% → 즉 비싼 시기에도 10번 중 {round((1 - crash[top].mean()) * 10)}번은 1년 안에 -20% 폭락이 오지 않았다")


if __name__ == "__main__":
    part_a()
    part_b()
    part_c()
    part_d()
