# -*- coding: utf-8 -*-
"""
H74 (2026-10-27): 최근 4분기 연속 영업적자 종목은 이후 60거래일 −20% 이하 손실이 더 잦은가.
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §20에 결과 보기 전 고정.

실행: python scripts/research/validate_operating_loss_avoid.py > .research-cache/operating_loss_out.txt
"""
import datetime as dt
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import revalidate_rules as rv

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CACHE = ".research-cache"
HZ, BIG, MIN_FLAG, START = 60, -0.20, 8, "20170428"
QEND = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}

px = pickle.load(open(f"{CACHE}/px.pkl", "rb"))
fin = rv.parse_financials(CACHE)
corps = json.load(open(f"{CACHE}/corps.json", encoding="utf-8"))
names = {c[2]: c[1] for c in corps}
codes = [c for c, v in px.items() if len(v) > 300 and not any(k in names.get(c, "") for k in ("스팩", "기업인수목적"))]
dates = sorted({r[0] for c in codes for r in px[c]})
di = {d: i for i, d in enumerate(dates)}
T, N = len(dates), len(codes)
C = np.full((T, N), np.nan)
TV = np.full((T, N), np.nan)
for j, c in enumerate(codes):
    for r in px[c]:
        i = di[r[0]]
        C[i, j] = r[4]
        TV[i, j] = r[4] * r[5]
last = T - 1 - np.argmax(~np.isnan(C[::-1]), axis=0)
first = np.argmax(~np.isnan(C), axis=0)
Cf = C.copy()
for j in range(N):
    v = np.nan
    for i in range(first[j], T):
        if i <= last[j] and not np.isnan(Cf[i, j]):
            v = Cf[i, j]
        else:
            Cf[i, j] = v
TV20 = np.full((T, N), np.nan)
for j in range(N):
    s = np.nan_to_num(TV[:, j])
    cs = np.cumsum(s)
    TV20[19:, j] = (cs[19:] - np.concatenate(([0], cs[:-20]))) / 20


def qend_date(y, q):
    m, d = QEND[q]
    return dt.date(y, m, d)


def valid_quarters(code):
    """{(y,q): (rcept, op_q)} — 정정·지연 공시 제외"""
    out = {}
    for r in fin.get(code, []):
        if r.get("op_q") is None:
            continue
        rc = r["rcept"]
        lag = (dt.date(int(rc[:4]), int(rc[4:6]), int(rc[6:])) - qend_date(r["y"], r["q"])).days
        if not (0 < lag <= (110 if r["q"] == 4 else 75)):
            continue
        out[(r["y"], r["q"])] = (rc, r["op_q"])
    return out


VQ = {c: valid_quarters(c) for c in codes}


def prev(y, q):
    return (y, q - 1) if q > 1 else (y - 1, 4)


def loss4(code, d):
    """d(YYYYMMDD) 시점에 공시로 알려진 가장 최근 연속 4분기 영업이익이 모두 < 0 이면 True, 판단 불가면 None"""
    v = VQ[code]
    known = [(k, x) for k, x in v.items() if x[0] <= d]
    if not known:
        return None
    k = max(known, key=lambda t: t[0])[0]
    if (dt.date(int(d[:4]), int(d[4:6]), int(d[6:])) - qend_date(*k)).days > 200:
        return None
    chain = [k]
    for _ in range(3):
        chain.append(prev(*chain[-1]))
    vals = []
    for kk in chain:
        if kk not in v or v[kk][0] > d:
            return None
        vals.append(v[kk][1])
    return all(x < 0 for x in vals)


def nw_t(x, lag=3):
    x = np.asarray(x)
    n = len(x)
    e = x - x.mean()
    v = e @ e / n
    for l in range(1, lag + 1):
        v += 2 * (1 - l / (lag + 1)) * (e[l:] @ e[:-l]) / n
    return x.mean() / np.sqrt(v / n)


def study(label, top):
    me = [i for i in range(T - 1) if dates[i][:6] != dates[i + 1][:6] and dates[i] >= START]
    rows = []
    for i in me:
        e = i + 1
        if e + HZ >= T:
            continue
        el = [j for j in range(N) if first[j] + 250 <= i <= last[j] and not np.isnan(Cf[i, j])
              and not np.isnan(Cf[e, j]) and TV20[i, j] >= 1e9]
        if top:
            el = sorted(el, key=lambda j: -TV20[i, j])[:top]
        flag, ret = [], []
        for j in el:
            f = loss4(codes[j], dates[i])
            if f is None:
                continue
            flag.append(f)
            ret.append(Cf[e + HZ, j] / Cf[e, j] - 1)
        flag, ret = np.array(flag, bool), np.array(ret)
        if flag.sum() < MIN_FLAG or (~flag).sum() < MIN_FLAG:
            continue
        big = ret <= BIG
        rows.append((dates[i], int(flag.sum()), int(len(flag)), big[flag].mean() - big[~flag].mean(),
                     ret[flag].mean() - ret[~flag].mean(), (ret[flag] <= -0.30).mean() - (ret[~flag] <= -0.30).mean(),
                     big[flag].mean(), big[~flag].mean()))
    print(f"\n===== {label} =====")
    if not rows:
        print("포함 월 0개"); return None
    d_big = np.array([r[3] for r in rows])
    d_ex = np.array([r[4] for r in rows])
    d_30 = np.array([r[5] for r in rows])
    h = len(rows) // 2
    t = nw_t(d_big)
    print(f"포함 월 {len(rows)}개 ({rows[0][0]}~{rows[-1][0]}) · 월평균 켜짐 {np.mean([r[1] for r in rows]):.1f}종목 / 판단 가능 {np.mean([r[2] for r in rows]):.0f}종목")
    print(f"−20% 이하 비율 켜짐 {np.mean([r[6] for r in rows]):.1%} vs 꺼짐 {np.mean([r[7] for r in rows]):.1%} · 월별 차이 평균 {d_big.mean():+.2%}p (NW t {t:+.2f}) · 양(+)인 달 {np.mean(d_big > 0):.0%}")
    print(f"   전반 {d_big[:h].mean():+.2%}p / 후반 {d_big[h:].mean():+.2%}p · 보조: −30% 이하 비율 차이 {d_30.mean():+.2%}p · 평균 초과수익(켜짐−꺼짐) {d_ex.mean():+.2%}")
    return dict(n=len(rows), d=d_big.mean(), t=t, halves=(d_big[:h].mean(), d_big[h:].mean()))


def vol_controlled(top=300):
    """사후 점검(판정 아님): 직전 60일 변동성 3분위 안에서 켜짐−꺼짐 큰 손실 비율 차이(켜짐 수 가중 평균)."""
    me = [i for i in range(T - 1) if dates[i][:6] != dates[i + 1][:6] and dates[i] >= START]
    diffs, flag_vol, off_vol = [], [], []
    for i in me:
        e = i + 1
        if e + HZ >= T or i < 61:
            continue
        el = [j for j in range(N) if first[j] + 250 <= i <= last[j] and not np.isnan(Cf[i, j])
              and not np.isnan(Cf[e, j]) and TV20[i, j] >= 1e9]
        el = sorted(el, key=lambda j: -TV20[i, j])[:top]
        rows = []
        for j in el:
            f = loss4(codes[j], dates[i])
            if f is None:
                continue
            seg = Cf[i - 60:i + 1, j]
            if np.isnan(seg).any():
                continue
            v = np.std(np.diff(np.log(seg)))
            rows.append((f, v, Cf[e + HZ, j] / Cf[e, j] - 1 <= BIG))
        if len(rows) < 60:
            continue
        f = np.array([r[0] for r in rows]); v = np.array([r[1] for r in rows]); b = np.array([r[2] for r in rows])
        if f.sum() < MIN_FLAG:
            continue
        flag_vol.append(v[f].mean()); off_vol.append(v[~f].mean())
        edges = np.quantile(v, [1 / 3, 2 / 3])
        g = np.digitize(v, edges)
        num = den = 0.0
        for k in range(3):
            on, off = f & (g == k), (~f) & (g == k)
            if on.sum() >= 2 and off.sum() >= 2:
                num += on.sum() * (b[on].mean() - b[off].mean())
                den += on.sum()
        if den:
            diffs.append(num / den)
    d = np.array(diffs)
    print(f"\n===== 사후 점검(판정 아님): 직전 60일 변동성 3분위 통제 =====")
    print(f"포함 월 {len(d)}개 · 켜짐 평균 일변동성 {np.mean(flag_vol):.3f} vs 꺼짐 {np.mean(off_vol):.3f}")
    print(f"통제 후 −20% 이하 비율 차이 월평균 {d.mean():+.2%}p (NW t {nw_t(d):+.2f}) · 양(+)인 달 {np.mean(d > 0):.0%} · 전반 {d[:len(d)//2].mean():+.2%}p / 후반 {d[len(d)//2:].mean():+.2%}p")


def main():
    print(f"H74 — 4분기 연속 영업적자, 진입 신호 다음 거래일 종가, 보유 {HZ}거래일, 큰 손실 ≤ {BIG:.0%}")
    a = study("주: 거래대금 상위 300", 300)
    study("보조(판정 아님): 거래대금 10억 이상 전체", None)
    print("\n===== 판정 (주 유니버스) =====")
    if not a or a["n"] < 36:
        print(f"보류 (포함 월 {a['n'] if a else 0}개 < 36)"); return
    if a["d"] <= 0:
        v = "기각 (월별 차이 평균 ≤ 0)"
    elif a["t"] >= 2 and all(x > 0 for x in a["halves"]):
        v = "성립"
    else:
        v = "미달 (일부만 충족)"
    print(f"월 {a['n']} · 차이 {a['d']:+.2%}p · NW t {a['t']:+.2f} · 전반/후반 {a['halves'][0]:+.2%}/{a['halves'][1]:+.2%} → {v}")
    vol_controlled()


if __name__ == "__main__":
    main()
