# -*- coding: utf-8 -*-
"""
H71 (2026-10-27): 가용 데이터 약 18개를 넣은 규제 로지스틱(M2)과 Platt 보정(M2c)이 단순 규칙 B2보다 −7% 낙폭을 잘 맞히는가.
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §15에 결과 보기 전 고정.

실행: python scripts/research/forecast_all_data.py > .research-cache/forecast_all_data_out.txt
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import forecast_backfill as fb          # 코스피 축·기본 특징 8개·로지스틱·부트스트랩 재사용
import forecast_rule_b2 as rb           # 시장 축(S&P)용

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = fb.C
H = fb.H
dates, T, K = fb.dates, fb.T, fb.K
C_RIDGE = 0.05
ERA = "20200101"


def monthly(path_key, lag_months):
    """월 값(YYYYMM)을 코스피 거래일 축에, 발표 지연(lag_months) 뒤 첫 거래일부터 반영."""
    r = json.load(open(C + "macro_leading/ecos_kr.json", encoding="utf-8"))
    d = r[path_key]
    out = np.full(T, np.nan)
    avail = {}
    for ym, v in d.items():
        y, m = int(ym[:4]), int(ym[4:6]) + lag_months
        y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
        avail[f"{y}{m:02d}"] = (ym, v)
    last = np.nan
    seen = set()
    hist = {}
    for i, dt in enumerate(dates):
        ym = dt[:6]
        if ym in avail and ym not in seen:
            seen.add(ym)
            last = avail[ym][1]
        out[i] = last
    return out


def kospi_features():
    X0 = fb.X                                    # 8개
    ret = lambda n: np.concatenate([np.full(n, np.nan), K[n:] / K[:-n] - 1])
    SP = fb.on_axis(json.load(open(C + "yh_GSPC_daily.json")), lag=1)
    TNX = fb.on_axis([(x[0], x[1]) for x in json.load(open(C + "yh_TNX_daily.json"))], lag=1)
    VIX = fb.VIX
    lead = monthly(list(json.load(open(C + "macro_leading/ecos_kr.json", encoding="utf-8")))[0], 2)
    rv5 = fb.roll(np.concatenate([[np.nan], np.diff(np.log(K))]), 5, np.nanstd)
    rv20 = fb.roll(np.concatenate([[np.nan], np.diff(np.log(K))]), 20, np.nanstd)
    g = [
        fb.DD4W,
        ret(5), ret(60),
        rv5 / rv20,
        np.concatenate([np.full(20, np.nan), SP[20:] / SP[:-20] - 1]),
        SP / fb.roll(SP, 120, np.nanmax) - 1,
        np.concatenate([np.full(5, np.nan), np.log(VIX[5:] / VIX[:-5])]),
        np.concatenate([np.full(60, np.nan), TNX[60:] - TNX[:-60]]),
        lead - 100,
        np.concatenate([np.full(63, np.nan), lead[63:] - lead[:-63]]),
    ]
    return np.column_stack([X0] + g)


XA = kospi_features()
NF = XA.shape[1]
Y, WEEKLY, idx_of = fb.Y, fb.WEEKLY, fb.idx_of


def rows_all(a, b):
    return np.array([i for i in WEEKLY if a <= dates[i] < b and np.isfinite(XA[i]).all()
                     and np.isfinite(Y[i]) and np.isfinite(fb.DD4W[i])], int)


def fit(train, cols=None):
    cols = cols if cols is not None else list(range(NF))
    mu, sd = XA[train][:, cols].mean(0), XA[train][:, cols].std(0) + 1e-9
    m = fb.LogisticRegression(C=C_RIDGE, max_iter=200).fit((XA[train][:, cols] - mu) / sd, Y[train])
    return lambda ix: m.predict_proba((XA[ix][:, cols] - mu) / sd)[:, 1]


def lg(p):
    p = np.clip(p, 1e-3, 1 - 1e-3)
    return np.log(p / (1 - p))


def walk():
    res = {k: [] for k in ("idx", "b1", "b2", "m2", "m2c")}
    hist = []                                   # (예측 시점 인덱스, m2 확률)
    for yr in range(2013, int(dates[-1][:4]) + 1):
        t0, t1 = f"{yr}0101", f"{yr + 1}0101"
        cut = next(i for i, d in enumerate(dates) if d >= t0)
        train = np.array([i for i in rows_all("20060101", t0) if i + H < cut], int)
        test = rows_all(t0, t1)
        if len(train) < 150 or len(test) == 0:
            continue
        # 기준선: 코스피 B1/B2 (변동성 열 0 = fb.X[:,0] 이 아니라 동일 정의의 fb.baselines 사용)
        _, p1, p2 = fb.baselines(train, test)
        pm = fit(train)(test)
        # 보정: 결과가 이미 확정된 과거 예측만 사용(3년 이상 쌓인 뒤)
        pc = pm.copy()
        past = [(i, p) for i, p in hist if i + H < cut]
        if yr >= 2016 and len(past) > 150:
            pi = np.array([i for i, _ in past]); pp = np.array([p for _, p in past])
            cal = fb.LogisticRegression(C=1e6, max_iter=100).fit(lg(pp).reshape(-1, 1), Y[pi])
            pc = cal.predict_proba(lg(pm).reshape(-1, 1))[:, 1]
        hist += list(zip(test, pm))
        res["idx"] += list(test); res["b1"] += list(p1); res["b2"] += list(p2)
        res["m2"] += list(pm); res["m2c"] += list(pc)
    return {k: np.array(v) for k, v in res.items()}


def judge(name, ix, p, pb, label_b, extra_ok=True):
    y = Y[ix]
    era = np.array([dates[i] >= ERA for i in ix])
    ev = fb.indep_events(ix, y)
    s = fb.skill(p, pb, y)
    lo, mid, hi = fb.boot_skill(p, pb, y)
    sa = fb.skill(p[~era], pb[~era], y[~era]); sb = fb.skill(p[era], pb[era], y[era])
    sl = fb.calib_slope(p, y)
    print(f"[{name}] n={len(ix)} 독립 사건 {ev} · Brier {fb.brier(p, y):.4f} vs {label_b} {fb.brier(pb, y):.4f}")
    print(f"    스킬 vs {label_b} {s:+.3f} [90% {lo:+.3f}, {hi:+.3f}] · 전반 {sa:+.3f} · 후반(2020~) {sb:+.3f} · 보정 기울기 {sl:.2f}")
    ok = s > 0 and lo > 0 and sa > 0 and sb > 0 and 0.7 <= sl <= 1.3 and ev >= 15
    return s, ok, ev


def sp500_us_only():
    dsp, Ksp = rb.load("yh_GSPC_daily.json")
    m = rb.Mkt(dsp, Ksp)
    VIX = np.full(m.T, np.nan)
    vd = dict((a, b) for a, b in json.load(open(C + "yh_VIX_daily.json")))
    last = np.nan
    for i, dt in enumerate(dsp):
        v = vd.get(dt); last = v if v is not None else last; VIX[i] = last
    TD = dict((x[0], x[1]) for x in json.load(open(C + "yh_TNX_daily.json")))
    TNX = np.full(m.T, np.nan); last = np.nan
    for i, dt in enumerate(dsp):
        v = TD.get(dt); last = v if v is not None else last; TNX[i] = last
    kk = m.K
    f = np.column_stack([
        m.vol, m.dd,
        np.concatenate([np.full(5, np.nan), kk[5:] / kk[:-5] - 1]),
        np.concatenate([np.full(60, np.nan), kk[60:] / kk[:-60] - 1]),
        np.log(VIX),
        np.concatenate([np.full(5, np.nan), np.log(VIX[5:] / VIX[:-5])]),
        np.concatenate([np.full(60, np.nan), TNX[60:] - TNX[:-60]]),
    ])
    ok = lambda i: np.isfinite(f[i]).all()
    res = {"idx": [], "b2": [], "m": []}
    for yr in range(2003, int(dsp[-1][:4]) + 1):
        t0, t1 = f"{yr}0101", f"{yr + 1}0101"
        cut = m.first_idx(t0)
        train = np.array([i for i in m.rows("19910101", t0) if i + H < cut and ok(i)], int)
        test = np.array([i for i in m.rows(t0, t1) if ok(i)], int)
        if len(train) < 150 or len(test) == 0:
            continue
        _, _, p2 = m.predict(train, test)
        mu, sd = f[train].mean(0), f[train].std(0) + 1e-9
        mod = fb.LogisticRegression(C=C_RIDGE, max_iter=200).fit((f[train] - mu) / sd, m.y[train])
        res["idx"] += list(test); res["b2"] += list(p2)
        res["m"] += list(mod.predict_proba((f[test] - mu) / sd)[:, 1])
    ix = np.array(res["idx"]); y = m.y[ix]
    pm, pb = np.array(res["m"]), np.array(res["b2"])
    s = fb.skill(pm, pb, y)
    lo, _, hi = fb.boot_skill(pm, pb, y)
    print(f"[S&P500 M2-US 2003~] n={len(ix)} 독립 사건 {fb.indep_events(ix, y)} · Brier {fb.brier(pm, y):.4f} vs B2 {fb.brier(pb, y):.4f}")
    print(f"    스킬 vs B2 {s:+.3f} [90% {lo:+.3f}, {hi:+.3f}] · 보정 기울기 {fb.calib_slope(pm, y):.2f}")
    return s


def main():
    print(f"특징 {NF}개(코스피). 모형 L2 C={C_RIDGE}. 비교 기준은 B2(직전 20일 고점 대비 −5% 규칙).")
    r = walk()
    ix = r["idx"]
    y = Y[ix]
    print(f"\n코스피 예측 {len(ix)}회 · 발생 {int(y.sum())}({y.mean():.1%}) · {dates[ix[0]]}~{dates[ix[-1]]}")
    print(f"Brier: B1 {fb.brier(r['b1'], y):.4f} · B2 {fb.brier(r['b2'], y):.4f} · M2 {fb.brier(r['m2'], y):.4f}")
    print("\n--- 주 판정 ---")
    s_m2, ok_m2, ev = judge("M2 2013~", ix, r["m2"], r["b2"], "B2")
    judge("M2 vs B1 (보조)", ix, r["m2"], r["b1"], "B1")
    sel = np.array([dates[i] >= "20160101" for i in ix])
    s_c, ok_c, _ = judge("M2c 2016~", ix[sel], r["m2c"][sel], r["b2"][sel], "B2")
    judge("M2(보정 전) 2016~ 같은 기간", ix[sel], r["m2"][sel], r["b2"][sel], "B2")
    print("\n--- 보조 판정 ---")
    s_us = sp500_us_only()
    print("\n--- 판정 ---")
    for name, s, ok in (("M2", s_m2, ok_m2), ("M2c", s_c, ok_c)):
        if s <= 0:
            v = "기각 (코스피 B2 대비 스킬 ≤ 0)"
        elif ok and s_us > 0:
            v = "통과"
        else:
            v = "미달 (일부만 충족)" + ("" if s_us > 0 else " · S&P 보조도 불충족")
        print(f"{name}: {v}")


if __name__ == "__main__":
    main()
