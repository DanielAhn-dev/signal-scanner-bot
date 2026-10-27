# -*- coding: utf-8 -*-
"""
H76 (2026-10-27): 향후 20거래일 변동성을 HAR형(실현변동성 5·20·60일 + VKOSPI/VIX)이 단순 추정보다 잘 예측하는가.
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §23에 결과 보기 전 고정.

실행: python scripts/research/validate_vol_forecast.py > .research-cache/vol_forecast_out.txt
"""
import json
import sys
from datetime import date as _d

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
H = 20
BLOCK, NBOOT = 4, 10000
rng = np.random.default_rng(20261027)


def load(path, col=1):
    r = json.load(open(C + path, encoding="utf-8"))
    d = {x[0]: float(x[col]) for x in r}
    ds = sorted(d)
    return ds, np.array([d[x] for x in ds])


def aligned(dates, pairs, lag):
    d = dict(pairs)
    out = np.full(len(dates), np.nan)
    last = np.nan
    for i, dt in enumerate(dates):
        if dt in d:
            last = d[dt]
        out[i] = last
    return np.concatenate([np.full(lag, np.nan), out[:len(out) - lag]]) if lag else out


def roll_std(x, w):
    out = np.full(len(x), np.nan)
    for i in range(w - 1, len(x)):
        seg = x[i - w + 1:i + 1]
        if np.isfinite(seg).all():
            out[i] = np.std(seg)
    return out


def weekly(dates):
    wk = {}
    for i, dt in enumerate(dates):
        y, w, _ = _d(int(dt[:4]), int(dt[4:6]), int(dt[6:])).isocalendar()
        wk[(y, w)] = i
    return sorted(wk.values())


def ols(X, y, ridge=1e-6):
    A = np.column_stack([np.ones(len(X)), X])
    I = np.eye(A.shape[1]) * ridge
    I[0, 0] = 0
    return np.linalg.solve(A.T @ A + I, A.T @ y)


def run(name, dates, K, implied, tr0, te0, split):
    T = len(K)
    ret = np.concatenate([[np.nan], np.diff(np.log(K))])
    ann = np.sqrt(252)
    rv = {w: roll_std(ret, w) * ann for w in (5, 20, 60)}
    fwd = np.full(T, np.nan)
    for i in range(T - H):
        seg = ret[i + 1:i + H + 1]
        if np.isfinite(seg).all():
            fwd[i] = np.std(seg) * ann
    # EWMA(0.94)
    ew = np.full(T, np.nan)
    v = np.nan
    for i in range(T):
        r = ret[i]
        if not np.isfinite(r):
            continue
        v = r * r if not np.isfinite(v) else 0.94 * v + 0.06 * r * r
        if i > 60:
            ew[i] = np.sqrt(v) * ann
    imp = implied / 100.0                                         # VKOSPI·VIX는 연율 %
    imp5 = np.full(T, np.nan)
    for i in range(4, T):
        seg = imp[i - 4:i + 1]
        if np.isfinite(seg).all():
            imp5[i] = seg.mean()
    feats = np.column_stack([np.log(rv[5]), np.log(rv[20]), np.log(rv[60]), np.log(imp5)])
    target = np.log(fwd)
    base_a, base_b, base_c = np.log(rv[20]), np.log(ew), np.log(imp5)
    ix_all = [i for i in weekly(dates) if np.isfinite(feats[i]).all() and np.isfinite(target[i]) and np.isfinite(base_b[i])]
    ix_all = np.array(ix_all)
    out = {"idx": [], "h": [], "a": [], "b": [], "c": []}
    for yr in range(int(te0[:4]), int(dates[-1][:4]) + 1):
        t0, t1 = f"{yr}0101", f"{yr + 1}0101"
        cut = next((i for i, d in enumerate(dates) if d >= t0), T)
        tr = np.array([i for i in ix_all if tr0 <= dates[i] < t0 and i + H < cut], int)
        te = np.array([i for i in ix_all if t0 <= dates[i] < t1], int)
        if len(tr) < 150 or len(te) == 0:
            continue
        beta = ols(feats[tr], target[tr])
        pred = np.column_stack([np.ones(len(te)), feats[te]]) @ beta
        bias_c = np.mean(target[tr] - base_c[tr])            # 내재변동성은 수준 편향만 학습 구간 평균으로 보정
        out["idx"] += list(te)
        out["h"] += list(pred)
        out["a"] += list(base_a[te])
        out["b"] += list(base_b[te])
        out["c"] += list(base_c[te] + bias_c)
    ix = np.array(out["idx"])
    y = target[ix]
    errs = {k: (np.array(out[k]) - y) ** 2 for k in ("h", "a", "b", "c")}
    era = np.array([dates[i] >= split for i in ix])
    n = len(ix)
    nb = int(np.ceil(n / BLOCK))
    st = rng.integers(0, n - BLOCK + 1, size=(NBOOT, nb))
    bi = (st[:, :, None] + np.arange(BLOCK)).reshape(NBOOT, -1)[:, :n]
    print(f"\n===== {name} ({dates[ix[0]]}~{dates[ix[-1]]}, 표본 {n}주) =====")
    print("로그 변동성 MSE: HAR형 {:.4f} · 직전 20일 {:.4f} · EWMA {:.4f} · 내재변동성(보정) {:.4f}".format(*(errs[k].mean() for k in ("h", "a", "b", "c"))))
    res = {}
    for k, lab in (("a", "직전 20일"), ("b", "EWMA"), ("c", "내재변동성")):
        s = 1 - errs["h"].sum() / errs[k].sum()
        sb = 1 - errs["h"][bi].sum(1) / errs[k][bi].sum(1)
        lo, hi = np.percentile(sb, [5, 95])
        s1 = 1 - errs["h"][~era].sum() / errs[k][~era].sum() if (~era).sum() > 20 else float("nan")
        s2 = 1 - errs["h"][era].sum() / errs[k][era].sum() if era.sum() > 20 else float("nan")
        print(f"  vs {lab}: 스킬 {s:+.3f} [90% {lo:+.3f}, {hi:+.3f}] · 전반 {s1:+.3f} · 후반 {s2:+.3f}")
        res[k] = dict(s=s, lo=lo, s1=s1, s2=s2)
    return res


def main():
    dk, Kk = load("kospi.json")
    vk = aligned(dk, json.load(open(C + "vkospi.json")), 0)
    rk = run("코스피 (VKOSPI)", dk, Kk, vk, "20040101", "20130101", "20200101")
    ds, Ks = load("yh_GSPC_daily.json")
    vx = aligned(ds, json.load(open(C + "yh_VIX_daily.json")), 1)
    rs = run("S&P500 (VIX, 1일 지연)", ds, Ks, vx, "19910101", "20030101", "20200101")
    print("\n===== 판정 =====")
    if rk["a"]["s"] <= 0:
        v = "기각 (코스피 직전 20일 대비 스킬 ≤ 0)"
    else:
        ok_kr = all(rk[k]["s"] > 0 and rk[k]["lo"] > 0 and rk[k]["s1"] > 0 and rk[k]["s2"] > 0 for k in "abc")
        ok_us = all(rs[k]["s"] > 0 for k in "abc")
        v = "성립" if (ok_kr and ok_us) else "미달 (일부만 충족)"
    print(v)


if __name__ == "__main__":
    main()
