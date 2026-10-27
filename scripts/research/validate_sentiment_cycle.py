# -*- coding: utf-8 -*-
"""
H82 (2026-10-27): 시장 심리 점수의 과열(≥75)·공포(≤25) 극단이 이후 60거래일 수익과 역발상 관계인가.
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §34에 결과 보기 전 고정.

실행: python scripts/research/validate_sentiment_cycle.py > .research-cache/sentiment_cycle_out.txt
"""
import json
import sys
from datetime import date as _d

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
WIN, MINOBS = 500, 250
HI, LO = 75, 25
HZ, BLOCK, NBOOT = 60, 13, 10000
rng = np.random.default_rng(20261027)


def load(path, col=1):
    r = json.load(open(C + path, encoding="utf-8"))
    d = {x[0]: float(x[col]) for x in r}
    ds = sorted(d)
    return ds, np.array([d[x] for x in ds])


def ffill(dates, d, lag=0, pick=lambda v: v):
    out = np.full(len(dates), np.nan)
    last = np.nan
    for i, dt in enumerate(dates):
        v = d.get(dt)
        if v is not None:
            x = pick(v)
            if x is not None:
                last = x
        out[i] = last
    return np.concatenate([np.full(lag, np.nan), out[:len(out) - lag]]) if lag else out


def roll(x, w, fn):
    out = np.full(len(x), np.nan)
    for i in range(w - 1, len(x)):
        seg = x[i - w + 1:i + 1]
        if np.isfinite(seg).all():
            out[i] = fn(seg)
    return out


def pct_rank(x, win=WIN, minobs=MINOBS):
    out = np.full(len(x), np.nan)
    for i in range(len(x)):
        if not np.isfinite(x[i]):
            continue
        h = x[max(0, i - win + 1):i + 1]
        h = h[np.isfinite(h)]
        if len(h) >= minobs:
            out[i] = (h <= x[i]).mean() * 100
    return out


def composite(parts, need):
    M = np.vstack(parts)
    ok = np.isfinite(M).sum(0) >= need
    out = np.full(M.shape[1], np.nan)
    out[ok] = np.nanmean(M[:, ok], axis=0)
    return out


def weekly(dates):
    wk = {}
    for i, dt in enumerate(dates):
        y, w, _ = _d(int(dt[:4]), int(dt[4:6]), int(dt[6:])).isocalendar()
        wk[(y, w)] = i
    return sorted(wk.values())


def price_parts(K, vol_series):
    mom = K / roll(K, 125, np.mean) - 1
    hi, lo = roll(K, 250, np.max), roll(K, 250, np.min)
    strength = (K - lo) / (hi - lo)
    vr = -(vol_series / roll(vol_series, 50, np.mean) - 1)
    return [pct_rank(mom), pct_rank(strength), pct_rank(vr)]


def evaluate(name, dates, K, score, start):
    T = len(K)
    ix = np.array([i for i in weekly(dates) if dates[i] >= start and np.isfinite(score[i]) and i + HZ < T])
    r60 = np.array([K[i + HZ] / K[i] - 1 for i in ix])
    r20 = np.array([K[i + 20] / K[i] - 1 for i in ix])
    t1 = np.array([float(K[i + 1:i + 21].min() / K[i] - 1 <= -0.07) for i in ix])
    sc = score[ix]
    print(f"\n===== {name} ({dates[ix[0]]}~{dates[ix[-1]]}, 표본 {len(ix)}주) =====")
    print(f"심리 점수 분포: 평균 {sc.mean():.1f} · 10% {np.percentile(sc, 10):.0f} · 90% {np.percentile(sc, 90):.0f} · 과열(≥{HI}) {np.mean(sc >= HI):.0%} · 공포(≤{LO}) {np.mean(sc <= LO):.0%}")
    n = len(ix)
    nb = int(np.ceil(n / BLOCK))
    st = rng.integers(0, n - BLOCK + 1, size=(NBOOT, nb))
    bi = (st[:, :, None] + np.arange(BLOCK)).reshape(NBOOT, -1)[:, :n]
    out = {}
    for lab, flag in (("과열", sc >= HI), ("공포", sc <= LO)):
        non = int(flag.sum())
        ep, last = 0, -999
        for i in ix[flag]:
            if i - last > 20:
                ep += 1
            last = i
        if non < 5:
            print(f"[{lab}] 켜짐 {non}주 — 표본 부족")
            out[lab] = None
            continue
        d60 = r60[flag].mean() - r60[~flag].mean()
        F, R = flag[bi], r60[bi]
        a, b = F.sum(1), (~F).sum(1)
        ok = (a > 0) & (b > 0)
        diff = ((R * F).sum(1) / np.maximum(a, 1) - (R * ~F).sum(1) / np.maximum(b, 1))[ok]
        p_lower = float((diff >= 0).mean())     # 과열: 켜짐이 낮다는 가설의 단측 p
        p_higher = float((diff <= 0).mean())    # 공포: 켜짐이 높다는 가설의 단측 p
        h = n // 2
        hv = [r60[:h][flag[:h]].mean() - r60[:h][~flag[:h]].mean() if flag[:h].any() else np.nan,
              r60[h:][flag[h:]].mean() - r60[h:][~flag[h:]].mean() if flag[h:].any() else np.nan]
        print(f"[{lab}] 켜짐 {non}주(독립 에피소드 {ep}) · 60일 수익 켜짐 {r60[flag].mean():+.1%} vs 꺼짐 {r60[~flag].mean():+.1%} → 차이 {d60:+.1%} "
              f"[90% {np.percentile(diff, 5):+.1%}, {np.percentile(diff, 95):+.1%}] · 단측 p {(p_lower if lab == '과열' else p_higher):.4f}")
        print(f"       반쪽별 차이 {hv[0]:+.1%} / {hv[1]:+.1%} · 20일 수익 차 {r20[flag].mean() - r20[~flag].mean():+.1%} · −7% 낙폭 20일 내 발생률 켜짐 {t1[flag].mean():.1%} vs 꺼짐 {t1[~flag].mean():.1%}")
        out[lab] = dict(d=d60, p=(p_lower if lab == "과열" else p_higher), ep=ep, hv=hv)
    return out


def main():
    dk, Kk = load("kospi.json")
    vk = ffill(dk, dict(json.load(open(C + "vkospi.json"))))
    fl = ffill(dk, json.load(open(C + "kospi_investor_flow.json")), lag=1, pick=lambda v: v[1] if v else None)
    fl = np.nan_to_num(fl)
    cr = ffill(dk, json.load(open(C + "freesis_credit.json")), lag=2, pick=lambda v: v[0] or None)
    credit60 = np.full(len(dk), np.nan)
    credit60[60:] = cr[60:] / cr[:-60] - 1
    parts = price_parts(Kk, vk) + [pct_rank(credit60), pct_rank(roll(fl, 20, np.sum))]
    score_k = composite(parts, 4)
    rk = evaluate("코스피 심리 점수(5요소)", dk, Kk, score_k, "20050601")

    ds, Ks = load("yh_GSPC_daily.json")
    vx = ffill(ds, {x[0]: x[1] for x in json.load(open(C + "yh_VIX_daily.json"))})
    score_s = composite(price_parts(Ks, vx), 3)
    rs = evaluate("S&P500 심리 점수(3요소, VIX)", ds, Ks, score_s, "19910101")

    print("\n===== 판정 (Holm 보정: 시험 2개) =====")
    pa, pb = (rk["과열"] or {}).get("p", 1.0), (rk["공포"] or {}).get("p", 1.0)
    order = sorted([("과열", pa), ("공포", pb)], key=lambda t: t[1])
    holm = {order[0][0]: min(1.0, 2 * order[0][1]), order[1][0]: min(1.0, max(2 * order[0][1], order[1][1]))}
    for lab, want_neg in (("과열", True), ("공포", False)):
        r, s = rk[lab], rs[lab]
        if not r or r["ep"] < 10:
            print(f"H82{'a' if lab == '과열' else 'b'} {lab}: 보류 (독립 에피소드 10 미만 또는 표본 부족)")
            continue
        sign = (lambda x: x < 0) if want_neg else (lambda x: x > 0)
        if not sign(r["d"]):
            v = "기각 (코스피 점추정이 가설과 반대)"
        elif holm[lab] < 0.05 and all(sign(x) for x in r["hv"]) and s and sign(s["d"]):
            v = "성립"
        else:
            v = "미달 (일부만 충족)"
        print(f"H82{'a' if lab == '과열' else 'b'} {lab}: 코스피 차이 {r['d']:+.1%} · Holm p {holm[lab]:.4f} · 반쪽 {r['hv'][0]:+.1%}/{r['hv'][1]:+.1%} · S&P 차이 {(s['d'] if s else float('nan')):+.1%} → {v}")


if __name__ == "__main__":
    main()
