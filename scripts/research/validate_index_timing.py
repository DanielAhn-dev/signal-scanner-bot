# -*- coding: utf-8 -*-
"""
지수 매수 타이밍 검증 (2026-10-01): 일시금 vs 분할 vs 일/주/월 적립 vs 50일선 관문.

데이터: .research-cache/kospi.json (코스피 가격지수 1996-12~, 생존편향 없음). 배당은 빠져 있지만
전략 간 상대 비교라 결론에는 영향이 작다(모든 전략이 같은 지수를 보유). 미투입 현금은 연 3% 가정.
신호는 전일 종가 기준, 체결은 당일 종가(룩어헤드 없음).

실험 A (목돈 T가 t0에 생겼을 때): 일시금 / 12·36개월 분할 / 50일선·200일선 위에서 한꺼번에 /
         -10% 눌림 대기(최대 12개월) — 5년 후 평가금 배율을 모든 월 시작점에서 비교.
실험 B (월급형: 매월 1씩 10년): 월초 / 월말 / 주 단위 / 일 단위 / 50일선·200일선 위에서만 투입(아래면 현금 적립).
"""
import json
import sys

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
ROOT = __file__.rsplit("scripts", 1)[0] + ".research-cache/"
rows = json.load(open(ROOT + "kospi.json", encoding="utf-8"))
rows.sort(key=lambda r: r[0])
dates = [r[0] for r in rows]
c = np.array([r[1] for r in rows], dtype=float)
N = len(c)
RC = 1.03 ** (1 / 250) - 1  # 현금 일수익률


def sma(w: int) -> np.ndarray:
    out = np.full(N, np.nan)
    cs = np.cumsum(c)
    out[w - 1:] = (cs[w - 1:] - np.concatenate(([0], cs[:-w]))) / w
    return out


S50, S200 = sma(50), sma(200)
# 월 첫 거래일 / 마지막 거래일 인덱스
month_first, month_last = {}, {}
for i, d in enumerate(dates):
    month_first.setdefault(d[:6], i)
    month_last[d[:6]] = i
months = sorted(month_first)
MF = [month_first[m] for m in months]
ML = [month_last[m] for m in months]


def above(i: int, s: np.ndarray) -> bool:
    return i >= 1 and not np.isnan(s[i - 1]) and c[i - 1] > s[i - 1]


def lump_run(s: int, e: int, mode: str) -> float:
    """목돈 1을 s에 받아 e에 평가한 배율."""
    cash, units = 1.0, 0.0
    step = 21
    parts = {"dca12": 12, "dca36": 36}.get(mode, 0)
    sent = 0
    for t in range(s, e + 1):
        if t > s:
            cash *= 1 + RC
        if cash <= 1e-12:
            continue
        buy = 0.0
        if mode == "lump":
            buy = cash if t == s else 0
        elif parts:
            if (t - s) % step == 0 and sent < parts:
                buy = 1.0 / parts
                sent += 1
        elif mode in ("gate50", "gate200"):
            if above(t, S50 if mode == "gate50" else S200):
                buy = cash
        elif mode == "dip10":
            hi = c[max(s, t - 60):t + 1].max()
            if c[t] <= hi * 0.9 or t - s >= 250:
                buy = cash
        buy = min(buy, cash)
        units += buy / c[t]
        cash -= buy
    return cash + units * c[e]


def stream_run(s: int, e: int, mode: str) -> tuple[float, float]:
    """매월 1씩 납입(월초 가정), 평가금과 총납입 반환."""
    cash, units, paid = 0.0, 0.0, 0.0
    first_days = set(MF)
    last_days = set(ML)
    for t in range(s, e + 1):
        cash *= 1 + RC
        if t in first_days:
            cash += 1.0
            paid += 1.0
        buy = 0.0
        if mode == "month_first":
            buy = cash if t in first_days else 0
        elif mode == "month_last":
            buy = cash if t in last_days else 0
        elif mode == "weekly":
            buy = cash if (t - s) % 5 == 0 else 0
        elif mode in ("gate50", "gate200"):
            buy = cash if above(t, S50 if mode == "gate50" else S200) else 0
        units += buy / c[t]
        cash -= buy
    return cash + units * c[e], paid


def stream_daily(s: int, e: int) -> tuple[float, float]:
    """매 거래일 소액 매수: 월 납입분을 그 달 거래일 수로 균등 분할."""
    cash, units, paid = 0.0, 0.0, 0.0
    first_days = set(MF)
    per_day = 0.0
    for t in range(s, e + 1):
        cash *= 1 + RC
        if t in first_days:
            m = dates[t][:6]
            n_days = ML[months.index(m)] - t + 1
            cash += 1.0
            paid += 1.0
            per_day = cash / n_days
        buy = min(per_day, cash)
        units += buy / c[t]
        cash -= buy
    return cash + units * c[e], paid


def pct(a, q):
    return float(np.percentile(a, q))


def exp_a(horizon_years: int, lo: str, hi: str, label: str) -> None:
    modes = ["lump", "dca12", "dca36", "gate50", "gate200", "dip10"]
    res = {m: [] for m in modes}
    starts = [MF[k] for k in range(len(MF)) if lo <= months[k] <= hi and MF[k] >= 200 and MF[k] + horizon_years * 250 < N]
    for s in starts:
        e = s + horizon_years * 250
        for m in modes:
            res[m].append(lump_run(s, e, m))
    base = np.array(res["lump"])
    print(f"\n[A] 목돈 {horizon_years}년 후 평가금 배율 — {label} (시작점 {len(starts)}개)")
    print(f"{'전략':8s} {'중앙값':>7s} {'하위10%':>8s} {'최악':>6s} {'평균':>6s} {'일시금 대비 승률':>14s}")
    for m in modes:
        a = np.array(res[m])
        win = float(np.mean(a > base)) * 100 if m != "lump" else float("nan")
        print(f"{m:8s} {pct(a,50):7.3f} {pct(a,10):8.3f} {a.min():6.3f} {a.mean():6.3f} {win:13.0f}%")


def exp_b(horizon_years: int, lo: str, hi: str, label: str) -> None:
    modes = ["month_first", "month_last", "weekly", "daily", "gate50", "gate200"]
    res = {m: [] for m in modes}
    starts = [MF[k] for k in range(len(MF)) if lo <= months[k] <= hi and MF[k] >= 200 and MF[k] + horizon_years * 250 < N]
    for s in starts:
        e = s + horizon_years * 250
        for m in modes:
            v, p = stream_daily(s, e) if m == "daily" else stream_run(s, e, m)
            res[m].append(v / p)
    base = np.array(res["month_first"])
    print(f"\n[B] 매월 적립 {horizon_years}년, 총납입 대비 평가금 배율 — {label} (시작점 {len(starts)}개)")
    print(f"{'전략':12s} {'중앙값':>7s} {'하위10%':>8s} {'최악':>6s} {'월초 대비 승률':>12s}")
    for m in modes:
        a = np.array(res[m])
        win = float(np.mean(a > base)) * 100 if m != "month_first" else float("nan")
        print(f"{m:12s} {pct(a,50):7.3f} {pct(a,10):8.3f} {a.min():6.3f} {win:11.0f}%")


if __name__ == "__main__":
    print(f"코스피 {dates[0]}~{dates[-1]} ({N}일), 현금 연3% 가정")
    for label, lo, hi in [("전체 1997~", "199701", "299912"), ("2009 이후 시작", "200901", "299912"), ("1997~2008 시작", "199701", "200812")]:
        exp_a(5, lo, hi, label)
    for label, lo, hi in [("전체 1997~", "199701", "299912"), ("2009 이후 시작", "200901", "299912")]:
        exp_b(10, lo, hi, label)
        exp_b(5, lo, hi, label)
