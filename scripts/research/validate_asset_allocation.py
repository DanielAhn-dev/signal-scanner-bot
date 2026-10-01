# -*- coding: utf-8 -*-
"""
자산배분·듀얼 모멘텀 검증 (2026-10-01). 국내 상장 ETF 4종, 공통 구간 2011-10~ (약 15년).
  KODEX200(069500) / TIGER미국나스닥100(133690) / KIWOOM국고채10년(148070) / KODEX골드선물(132030)
네이버 siseJson 종가(분배금 미반영 — 채권·배당 ETF에 약간 불리, 모든 전략에 같은 편향).
월말 판정 → 다음 거래일부터 반영(룩어헤드 없음), 비중 변화분에 0.1% 비용, 현금 연2.5%.
전략: 보유 / 정적 4자산 동일가중(올웨더 근사) / 듀얼모멘텀(주식2종 중 12M 강한 쪽, 현금수익보다 약하면 채권)
      / Faber식 10개월선(≈200일선) 위 자산만 동일가중 / 4자산 12M 모멘텀 상위1·상위2(절대모멘텀 필터) / 코스피 SMA50.
"""
import json, os, sys, urllib.request
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
ROOT = __file__.rsplit("scripts", 1)[0] + ".research-cache/"
ASSETS = {"KODEX200": "069500", "나스닥100": "133690", "국고채10년": "148070", "골드": "132030"}
RC = 1.025 ** (1 / 250) - 1
COST = 0.001


def load(code):
    path = ROOT + f"px_{code}.json"
    if not os.path.exists(path):
        u = f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1&startTime=20000101&endTime=20261001&timeframe=day"
        t = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode("utf-8", "ignore")
        rows = []
        for l in t.replace(" ", "").split("\n"):
            if l.startswith('["2'):
                p = l.strip().rstrip(",").strip("[]").split(",")
                rows.append([p[0].strip('"'), float(p[4])])
        json.dump(rows, open(path, "w", encoding="utf-8"))
    return dict((d, v) for d, v in json.load(open(path, encoding="utf-8")))


series = {n: load(c) for n, c in ASSETS.items()}
dates = sorted(set.intersection(*[set(s) for s in series.values()]))
P = np.array([[series[n][d] for n in ASSETS] for d in dates])  # (T, 4)
T = len(dates)
R = np.vstack([np.zeros(4), P[1:] / P[:-1] - 1])
ym = [d[:6] for d in dates]
month_end = [i for i in range(T) if i == T - 1 or ym[i] != ym[i + 1]]


def sma(x, w):
    out = np.full(len(x), np.nan); cs = np.cumsum(x)
    out[w - 1:] = (cs[w - 1:] - np.concatenate(([0], cs[:-w]))) / w
    return out


SMA = np.column_stack([sma(P[:, k], 200) for k in range(4)])
SMA50_K = sma(P[:, 0], 50)


def backtest(weight_fn, daily_rule=None):
    """weight_fn(i) -> 길이4 비중(합<=1, 나머지 현금). 월말에 갱신(daily_rule이면 매일)."""
    w = np.zeros(4); out = np.zeros(T); eq_w = np.zeros(T)
    pending = np.zeros(4)
    for i in range(T):
        # 어제 판정한 비중을 오늘 수익에 적용
        w_new = pending
        turn = np.abs(w_new - w).sum()
        out[i] = (w_new * R[i]).sum() + (1 - w_new.sum()) * RC - turn * COST if i > 0 else 0
        w = w_new * (1 + R[i]) / max(1e-12, 1 + (w_new * R[i]).sum())  # 드리프트 근사
        if daily_rule or i in month_set:
            pending = weight_fn(i)
    return out


month_set = set(month_end)
START = 250


def mom(i, k, n=250):
    return P[i, k] / P[i - n, k] - 1 if i >= n else np.nan


def w_hold(i): return np.array([1.0, 0, 0, 0])
def w_static(i): return np.full(4, 0.25)
def w_dual(i):
    if i < 250: return np.zeros(4)
    a, b = mom(i, 0), mom(i, 1)
    best = 0 if a >= b else 1
    w = np.zeros(4)
    if max(a, b) > 0.025: w[best] = 1.0
    else: w[2] = 1.0
    return w
def w_faber(i):
    ok = np.array([i >= 200 and P[i, k] > SMA[i, k] for k in range(4)], dtype=float)
    return ok / 4
def w_top(n):
    def f(i):
        if i < 250: return np.zeros(4)
        m = np.array([mom(i, k) for k in range(4)])
        order = np.argsort(-m)[:n]
        w = np.zeros(4)
        for k in order:
            if m[k] > 0.025: w[k] = 1.0 / n
        return w
    return f
def w_kospi50(i):
    return np.array([1.0 if i >= 50 and P[i, 0] > SMA50_K[i] else 0, 0, 0, 0])


def stats(d):
    eq = np.cumprod(1 + d); yrs = len(d) / 250
    return (eq[-1] ** (1 / yrs) - 1) * 100, (eq / np.maximum.accumulate(eq) - 1).min() * 100, (d.mean() * 250 - 0.025) / (d.std() * np.sqrt(250))


print(f"공통 구간 {dates[0]}~{dates[-1]} ({T}일). 평가 시작 {dates[START]}(워밍업 후)")
mid = (START + T) // 2
print(f"{'전략':28s} | {'CAGR':>5s} {'MDD':>7s} {'샤프':>5s} | 전반 {dates[START]}~{dates[mid]} | 후반")
for name, fn, daily in [("KODEX200 보유", w_hold, False), ("정적 4자산 동일가중", w_static, False), ("듀얼모멘텀(주식2→채권)", w_dual, False),
                        ("Faber 10개월선 4자산", w_faber, False), ("4자산 모멘텀 상위1", w_top(1), False), ("4자산 모멘텀 상위2", w_top(2), False),
                        ("코스피200 SMA50(현행 규칙)", w_kospi50, True)]:
    d = backtest(fn, daily)
    f, a, b = stats(d[START:]), stats(d[START:mid]), stats(d[mid:])
    print(f"{name:28s} | {f[0]:5.1f} {f[1]:7.1f} {f[2]:5.2f} | {a[0]:5.1f}/{a[1]:6.1f}      | {b[0]:5.1f}/{b[1]:6.1f}")
print("\n자산 단독 보유(참고)")
for k, n in enumerate(ASSETS):
    f = stats(R[START:, k]); print(f"{n:12s} {f[0]:5.1f} {f[1]:7.1f} {f[2]:5.2f}")
