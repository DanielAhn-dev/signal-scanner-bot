# -*- coding: utf-8 -*-
"""
H79(연속 적자 분기 수 용량-반응)·H81(중소형 재현)·데이터 정화 점검 (2026-10-27).
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §29~§31에 결과 보기 전 고정. H74(validate_operating_loss_avoid.py)의 자료·정의를 재사용한다.

실행: python scripts/research/validate_loss_streak_robust.py > .research-cache/loss_streak_robust_out.txt
"""
import datetime as dt
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_operating_loss_avoid as base  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

T, N, Cf, TV20, first, last, dates, codes = base.T, base.N, base.Cf, base.TV20, base.first, base.last, base.dates, base.codes
START, MIN_FLAG, CACHE = base.START, base.MIN_FLAG, base.CACHE
KS = (1, 2, 3, 4, 6, 8)
HZS = {20: -0.10, 60: -0.20, 120: -0.30}
JUMP = np.log(1.35)

with np.errstate(all="ignore"):
    LR = np.abs(np.diff(np.log(np.where(Cf > 0, Cf, np.nan)), axis=0))
JUMPS = np.zeros((T, N), bool)
JUMPS[1:] = np.nan_to_num(LR, nan=0.0) > JUMP
CUM = np.cumsum(JUMPS, axis=0)           # 구간 안 의심 이동 유무를 O(1)로


def has_jump(j, a, b):
    """[a, b] 구간에 의심 일간 이동이 있는가"""
    a = max(a, 0)
    return CUM[b, j] - (CUM[a - 1, j] if a > 0 else 0) > 0


def prev(y, q):
    return (y, q - 1) if q > 1 else (y - 1, 4)


def loss_chain(code, d):
    """d 시점 가장 최근 분기에서 거슬러 올라가며 영업이익이 연속으로 음수인 분기 수(0이면 최근 분기 흑자). 판단 불가면 None"""
    v = base.VQ[code]
    known = [(k, x) for k, x in v.items() if x[0] <= d]
    if not known:
        return None
    k = max(known, key=lambda t: t[0])[0]
    if (dt.date(int(d[:4]), int(d[4:6]), int(d[6:])) - base.qend_date(*k)).days > 200:
        return None
    n = 0
    while n < 8:
        if k not in v or v[k][0] > d:
            return n if n > 0 else None      # 첫 분기부터 값이 없으면 판단 불가
        if v[k][1] < 0:
            n += 1
            k = prev(*k)
        else:
            return n
    return n


def stat(d):
    d = np.asarray(d)
    h = len(d) // 2
    return dict(n=len(d), mean=d.mean(), t=base.nw_t(d) if len(d) > 5 else float("nan"), h1=d[:h].mean(), h2=d[h:].mean(), pos=np.mean(d > 0))


def run_universe(label, lo, hi, clean, market=None):
    me = [i for i in range(T - 1) if dates[i][:6] != dates[i + 1][:6] and dates[i] >= START]
    out = {(k, hz): [] for k in KS for hz in HZS}
    vcs, excl_on, excl_off, cnt_on, cnt_off = [], 0, 0, 0, 0
    for i in me:
        e = i + 1
        if e + 120 >= T or i < 61:
            continue
        el = [j for j in range(N) if first[j] + 250 <= i <= last[j] and not np.isnan(Cf[i, j]) and not np.isnan(Cf[e, j]) and TV20[i, j] >= 1e9
              and (market is None or MARKET.get(codes[j]) == market)]
        el = sorted(el, key=lambda j: -TV20[i, j])[lo:hi]
        recs = []
        for j in el:
            n = loss_chain(codes[j], dates[i])
            if n is None:
                continue
            seg = Cf[i - 60:i + 1, j]
            vol = np.std(np.diff(np.log(seg))) if not np.isnan(seg).any() else np.nan
            recs.append((j, n, vol))
        if len(recs) < 40:
            continue
        for hz, thr in HZS.items():
            keep = []
            for (j, n, vol) in recs:
                bad = has_jump(j, i - 60, e + hz)
                if hz == 60 and n >= 4:
                    cnt_on += 1; excl_on += bad
                elif hz == 60 and n == 0:
                    cnt_off += 1; excl_off += bad
                if clean and bad:
                    continue
                keep.append((j, n, vol, Cf[e + hz, j] / Cf[e, j] - 1 <= thr))
            if len(keep) < 30:
                continue
            nn = np.array([x[1] for x in keep]); big = np.array([x[3] for x in keep])
            for k in KS:
                flag = nn >= k
                if flag.sum() >= MIN_FLAG and (~flag).sum() >= MIN_FLAG:
                    out[(k, hz)].append(big[flag].mean() - big[~flag].mean())
            if hz == 60:
                vol = np.array([x[2] for x in keep]); ok = np.isfinite(vol)
                flag = nn >= 4
                if ok.sum() >= 40 and (flag & ok).sum() >= 2:
                    g = np.digitize(vol[ok], np.quantile(vol[ok], [1 / 3, 2 / 3]))
                    fo, bo = flag[ok], big[ok]
                    num = den = 0.0
                    for q in range(3):
                        on, off = fo & (g == q), (~fo) & (g == q)
                        if on.sum() >= 2 and off.sum() >= 2:
                            num += on.sum() * (bo[on].mean() - bo[off].mean()); den += on.sum()
                    if den:
                        vcs.append(num / den)
    print(f"\n===== {label} ({'정화' if clean else '정화 전'}) =====")
    if cnt_on and cnt_off:
        print(f"의심 이동 포함 관측 비율: 4분기+적자 {excl_on / cnt_on:.1%} · 최근 분기 흑자 {excl_off / cnt_off:.1%}")
    res = {}
    for k in KS:
        d = out[(k, 60)]
        if len(d) < 12:
            print(f"  k={k}: 포함 월 {len(d)}개(부족)")
            continue
        s = stat(d)
        res[k] = s
        print(f"  k={k}: 월 {s['n']} · 월별 차이 평균 {s['mean'] * 100:+.2f}%p (NW t {s['t']:+.2f}) · 양인 달 {s['pos']:.0%} · 전반 {s['h1'] * 100:+.2f} / 후반 {s['h2'] * 100:+.2f}")
    if out[(4, 20)] and out[(4, 120)]:
        print("  [k=4 보유기간] " + " · ".join(f"{hz}일 {HZS[hz]:.0%}↓ 차이 {np.mean(out[(4, hz)]) * 100:+.2f}%p(월 {len(out[(4, hz)])})" for hz in HZS if out[(4, hz)]))
    if vcs:
        v = np.array(vcs)
        res["vc"] = dict(mean=v.mean(), t=base.nw_t(v) if len(v) > 5 else float("nan"), n=len(v))
        print(f"  [k=4 변동성 통제 후] {v.mean() * 100:+.2f}%p (NW t {res['vc']['t']:+.2f}, 월 {len(v)})")
    return res


def held(res):
    r = res.get(4)
    vc = res.get("vc")
    return bool(r and vc and r["n"] >= 36 and r["mean"] > 0 and r["t"] >= 2 and r["h1"] > 0 and r["h2"] > 0 and vc["mean"] > 0)


def dose_response(res):
    ks = [k for k in (1, 2, 3, 4) if k in res]
    if len(ks) < 4:
        return "판정 불가"
    inc = all(res[a]["mean"] < res[b]["mean"] for a, b in zip(ks, ks[1:]))
    big_ok = all(res[k]["mean"] >= res[4]["mean"] for k in (6, 8) if k in res and res[k]["n"] >= 36)
    return "성립" if inc and big_ok else "불성립"


def load_market():
    try:
        sc = json.load(open(f"{CACHE}/stock_caps.json", encoding="utf-8"))
        return {r["code"]: r.get("market") for r in sc}
    except Exception:
        return {}


MARKET = load_market()


def main():
    print("H79·H81·정화 점검 — 신호 L(k): 최근 연속 k분기 영업이익 < 0, 월말 신호, 진입 다음 거래일 종가, 큰 손실 기준 보유기간별(20일 −10%·60일 −20%·120일 −30%)")
    t300 = run_universe("상위 300 (H74·H79)", 0, 300, False)
    t300c = run_universe("상위 300 (H74·H79)", 0, 300, True)
    m1 = run_universe("301~600위 (H81)", 300, 600, False)
    m1c = run_universe("301~600위 (H81)", 300, 600, True)
    m2 = run_universe("601~1000위 (H81)", 600, 1000, False)
    m2c = run_universe("601~1000위 (H81)", 600, 1000, True)
    kq = run_universe("KOSDAQ 라벨 종목만 상위 300 [기술, 생존편향]", 0, 300, True, market="KOSDAQ")
    print("\n===== 판정 =====")
    print(f"H74 정화 판 결론 유지: {held(t300c)} (정화 전 {held(t300)})")
    print(f"H79 용량-반응: 정화 전 {dose_response(t300)} · 정화 {dose_response(t300c)}")
    ok1, ok2 = held(m1c), held(m2c)
    neg = any(r.get(4, {}).get("mean", 1) <= 0 for r in (m1c, m2c))
    print(f"H81 (정화 판): 301~600위 {ok1} · 601~1000위 {ok2} → " + ("성립" if ok1 and ok2 else ("기각" if neg else "미달")))


if __name__ == "__main__":
    main()
