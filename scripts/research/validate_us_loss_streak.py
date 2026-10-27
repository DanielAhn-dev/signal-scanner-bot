# -*- coding: utf-8 -*-
"""
H80 (2026-10-27): 미국 종목에서도 최근 4분기 연속 영업적자 종목이 이후 60거래일 −20%↓ 손실이 더 잦은가 (H74 재현).
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §30·§33에 결과 보기 전 고정. 정화 전·후 모두 기준 충족해야 성립.
자료: fetch_us_fundamentals.py(SEC), fetch_us_prices.py(Yahoo). 현재 상장 종목만이라 상장폐지·파산이 빠진 생존편향이 있다.

실행: python scripts/research/validate_us_loss_streak.py > .research-cache/us_loss_streak_out.txt
"""
import datetime as dt
import json
import os
import sys
import urllib.parse

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = ".research-cache/us"
START, HZ, BIG, MIN_FLAG, TOPN = "20170428", 60, -0.20, 8, 500
JUMP = np.log(2.0)


def d2(s):
    return dt.date.fromisoformat(s)


# ── 분기 구성
def build_quarters(rows):
    """rows: [start, end, val, filed] → {end: (val, filed)} 분기 값(4분기는 연간 − 1~3분기)"""
    qs, ann = {}, []
    for s, e, v, f in rows:
        g = (d2(e) - d2(s)).days
        if 80 <= g <= 100:
            qs[e] = (v, f, s)
        elif 350 <= g <= 380:
            ann.append((s, e, v, f))
    out = {e: (v, f) for e, (v, f, _) in qs.items()}
    for s, e, v, f in ann:
        if e in out:
            continue
        inside = sorted((qe, qv) for qe, (qv, qf, qs_) in qs.items() if d2(s) <= d2(qs_) and d2(qe) < d2(e))
        if len(inside) == 3 and all(80 <= (d2(b[0]) - d2(a[0])).days <= 100 for a, b in zip(inside, inside[1:])):
            if 80 <= (d2(e) - d2(inside[-1][0])).days <= 100:
                out[e] = (v - sum(x[1] for x in inside), f)
    return out


def loss4(q, d):
    """q: {end:(val,filed)}, d: YYYYMMDD. 최근 연속 4분기가 모두 적자면 True, 아니면 False, 판단 불가면 None"""
    ds = f"{d[:4]}-{d[4:6]}-{d[6:]}"
    known = sorted(e for e, (v, f) in q.items() if f <= ds)
    if len(known) < 4:
        return None
    last4 = known[-4:]
    if (d2(ds) - d2(last4[-1])).days > 200:
        return None
    if not all(80 <= (d2(b) - d2(a)).days <= 100 for a, b in zip(last4, last4[1:])):
        return None
    return all(q[e][0] < 0 for e in last4)


def nw_t(x, lag=3):
    x = np.asarray(x)
    n = len(x)
    e = x - x.mean()
    v = e @ e / n
    for l in range(1, lag + 1):
        v += 2 * (1 - l / (lag + 1)) * (e[l:] @ e[:-l]) / n
    return x.mean() / np.sqrt(v / n)


def main():
    tick = json.load(open(f"{ROOT}/tickers.json"))
    qmap, tk_ok = {}, []
    for f in os.listdir(f"{ROOT}/ops"):
        d = json.load(open(f"{ROOT}/ops/{f}"))
        if not d["rows"]:
            continue
        q = build_quarters(d["rows"])
        pxf = f"{ROOT}/px/{urllib.parse.quote(d['ticker'], safe='')}.json"
        if q and os.path.exists(pxf):
            qmap[d["ticker"]] = q
            tk_ok.append(d["ticker"])
    tk_ok.sort()
    print(f"분기 자료와 가격이 모두 있는 종목 {len(tk_ok)}개")
    series = {}
    all_dates = set()
    for tk in tk_ok:
        d = json.load(open(f"{ROOT}/px/{urllib.parse.quote(tk, safe='')}.json"))
        if len(d["t"]) < 300:
            continue
        ds = [dt.datetime.utcfromtimestamp(t).strftime("%Y%m%d") for t in d["t"]]
        series[tk] = (ds, d["adj"], d["c"], d["v"])
        all_dates.update(ds)
    dates = sorted(all_dates)
    di = {x: i for i, x in enumerate(dates)}
    tks = sorted(series)
    T, N = len(dates), len(tks)
    A = np.full((T, N), np.nan)
    DV = np.full((T, N), np.nan)
    CL = np.full((T, N), np.nan)
    for j, tk in enumerate(tks):
        ds, adj, c, v = series[tk]
        for x, a, cc, vv in zip(ds, adj, c, v):
            if a is None or cc is None:
                continue
            i = di[x]
            A[i, j] = a
            CL[i, j] = cc
            DV[i, j] = cc * (vv or 0)
    first = np.array([np.argmax(~np.isnan(A[:, j])) if (~np.isnan(A[:, j])).any() else T for j in range(N)])
    DV20 = np.full((T, N), np.nan)
    z = np.nan_to_num(DV)
    cs = np.cumsum(z, axis=0)
    DV20[19:] = (cs[19:] - np.concatenate([np.zeros((1, N)), cs[:-20]])) / 20
    with np.errstate(all="ignore"):
        LR = np.abs(np.diff(np.log(np.where(A > 0, A, np.nan)), axis=0))
    JM = np.zeros((T, N), bool)
    JM[1:] = np.nan_to_num(LR, nan=0.0) > JUMP
    CUM = np.cumsum(JM, axis=0)

    def has_jump(j, a, b):
        a = max(a, 0)
        return CUM[b, j] - (CUM[a - 1, j] if a > 0 else 0) > 0

    me = [i for i in range(T - 1) if dates[i][:6] != dates[i + 1][:6] and dates[i] >= START]
    res = {}
    for clean in (False, True):
        rows, vcs, ex_on, n_on, ex_off, n_off = [], [], 0, 0, 0, 0
        for i in me:
            e = i + 1
            if e + HZ >= T or i < 61:
                continue
            el = [j for j in range(N) if first[j] + 250 <= i and not np.isnan(A[i, j]) and not np.isnan(A[e, j])
                  and not np.isnan(A[e + HZ, j]) and (CL[i, j] or 0) >= 1 and DV20[i, j] > 0]
            el = sorted(el, key=lambda j: -DV20[i, j])[:TOPN]
            rec = []
            for j in el:
                s = loss4(qmap[tks[j]], dates[i])
                if s is None:
                    continue
                bad = has_jump(j, i - 60, e + HZ)
                if s:
                    n_on += 1; ex_on += bad
                else:
                    n_off += 1; ex_off += bad
                if clean and bad:
                    continue
                seg = A[i - 60:i + 1, j]
                vol = np.std(np.diff(np.log(seg))) if not np.isnan(seg).any() else np.nan
                rec.append((s, vol, A[e + HZ, j] / A[e, j] - 1 <= BIG))
            flag = np.array([x[0] for x in rec], bool)
            if len(rec) < 40 or flag.sum() < MIN_FLAG or (~flag).sum() < MIN_FLAG:
                continue
            big = np.array([x[2] for x in rec])
            rows.append((dates[i], int(flag.sum()), big[flag].mean(), big[~flag].mean(), big[flag].mean() - big[~flag].mean()))
            vol = np.array([x[1] for x in rec])
            ok = np.isfinite(vol)
            if ok.sum() >= 40 and (flag & ok).sum() >= 2:
                g = np.digitize(vol[ok], np.quantile(vol[ok], [1 / 3, 2 / 3]))
                fo, bo = flag[ok], big[ok]
                num = den = 0.0
                for q in range(3):
                    on, off = fo & (g == q), (~fo) & (g == q)
                    if on.sum() >= 2 and off.sum() >= 2:
                        num += on.sum() * (bo[on].mean() - bo[off].mean())
                        den += on.sum()
                if den:
                    vcs.append(num / den)
        label = "정화" if clean else "정화 전"
        print(f"\n===== 미국 H80 ({label}) =====")
        if not rows:
            print("포함 월 0개")
            res[clean] = None
            continue
        d = np.array([r[4] for r in rows])
        h = len(d) // 2
        v = np.array(vcs)
        t = nw_t(d)
        tv = nw_t(v) if len(v) > 5 else float("nan")
        print(f"포함 월 {len(rows)}개 ({rows[0][0]}~{rows[-1][0]}) · 월평균 켜짐 {np.mean([r[1] for r in rows]):.1f}종목")
        print(f"의심 이동 포함 관측 비율: 4분기 연속 적자 {ex_on / max(n_on, 1):.1%} · 그 외 {ex_off / max(n_off, 1):.1%}")
        print(f"−20% 이하 비율 켜짐 {np.mean([r[2] for r in rows]):.1%} vs 꺼짐 {np.mean([r[3] for r in rows]):.1%} · 월별 차이 평균 {d.mean() * 100:+.2f}%p "
              f"(NW t {t:+.2f}) · 양인 달 {np.mean(d > 0):.0%} · 전반 {d[:h].mean() * 100:+.2f} / 후반 {d[h:].mean() * 100:+.2f}")
        print(f"변동성 3분위 통제 후 {v.mean() * 100:+.2f}%p (NW t {tv:+.2f}, 월 {len(v)})")
        ok = len(rows) >= 36 and d.mean() > 0 and t >= 2 and d[:h].mean() > 0 and d[h:].mean() > 0 and v.mean() > 0 and tv >= 2
        res[clean] = dict(ok=ok, n=len(rows), mean=d.mean())
    print("\n===== 판정 =====")
    a, b = res.get(False), res.get(True)
    if not a or not b or min(a["n"], b["n"]) < 36:
        print("보류 (포함 월 < 36 또는 자료 부족)")
    elif a["mean"] <= 0 or b["mean"] <= 0:
        print("기각 (평균 차이 ≤ 0)")
    elif a["ok"] and b["ok"]:
        print("성립 (정화 전·후 모두 기준 충족)")
    else:
        print(f"미달 (정화 전 {a['ok']} · 정화 {b['ok']})")


if __name__ == "__main__":
    main()
