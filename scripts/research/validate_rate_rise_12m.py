# -*- coding: utf-8 -*-
"""
H73 (2026-10-27): 미 10년물이 120거래일 동안 +1.0%p 이상 오른 구간 뒤 12개월(250거래일) 코스피 수익이 평소보다 낮은가.
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §19에 결과 보기 전 고정. 재현 시장: S&P500.

실행: python scripts/research/validate_rate_rise_12m.py > .research-cache/rate_rise_12m_out.txt
"""
import json
import sys
from datetime import date as _d

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
HZ, WIN, THR = 250, 120, 1.0
BLOCK, NBOOT = 52, 10000
rng = np.random.default_rng(20261027)


def load(path):
    r = json.load(open(C + path, encoding="utf-8"))
    d = {x[0]: float(x[1]) for x in r}
    ds = sorted(d)
    return ds, np.array([d[x] for x in ds])


def aligned_tnx(dates):
    d = {x[0]: float(x[1]) for x in json.load(open(C + "yh_TNX_daily.json"))}
    out = np.full(len(dates), np.nan)
    last = np.nan
    for i, dt in enumerate(dates):
        if dt in d:
            last = d[dt]
        out[i] = last
    return np.concatenate([[np.nan], out[:-1]])          # 해외 값 1일 지연


def weekly(dates):
    wk = {}
    for i, dt in enumerate(dates):
        y, w, _ = _d(int(dt[:4]), int(dt[4:6]), int(dt[6:])).isocalendar()
        wk[(y, w)] = i
    return sorted(wk.values())


def run(name, dates, K):
    T = len(K)
    tnx = aligned_tnx(dates)
    chg = np.full(T, np.nan)
    chg[WIN:] = tnx[WIN:] - tnx[:-WIN]
    ix = np.array([i for i in weekly(dates) if np.isfinite(chg[i]) and i + HZ < T])
    fwd = np.array([K[i + HZ] / K[i] - 1 for i in ix])
    mdd = np.array([K[i + 1:i + HZ + 1].min() / K[i] - 1 for i in ix])
    up, dn = chg[ix] >= THR, chg[ix] <= -THR
    print(f"\n===== {name} ({dates[ix[0]]}~{dates[ix[-1]]}, 표본 {len(ix)}주) =====")
    res = {}
    for lab, flag in (("금리 상승(≥+1.0%p)", up), ("금리 하락(≤−1.0%p) [기술]", dn)):
        n_on = int(flag.sum())
        ep, last = 0, -9999
        for i in ix[flag]:
            if i - last > HZ:
                ep += 1
            last = i
        if n_on < 5:
            print(f"{lab}: 켜짐 {n_on}주 — 표본 부족"); continue
        d_ret = fwd[flag].mean() - fwd[~flag].mean()
        d_mdd = mdd[flag].mean() - mdd[~flag].mean()
        # 블록 부트스트랩
        n = len(fwd)
        nb = int(np.ceil(n / BLOCK))
        st = rng.integers(0, n - BLOCK + 1, size=(NBOOT, nb))
        bi = (st[:, :, None] + np.arange(BLOCK)).reshape(NBOOT, -1)[:, :n]
        F, R = flag[bi], fwd[bi]
        non, noff = F.sum(1), (~F).sum(1)
        ok = (non > 0) & (noff > 0)
        diff = (R * F).sum(1) / np.maximum(non, 1) - (R * ~F).sum(1) / np.maximum(noff, 1)
        diff = diff[ok]
        p_lower = float((diff >= 0).mean())          # 켜짐이 더 낮다는 가설의 단측 p
        h = n // 2
        halves = [fwd[:h][flag[:h]].mean() - fwd[:h][~flag[:h]].mean() if flag[:h].any() else np.nan,
                  fwd[h:][flag[h:]].mean() - fwd[h:][~flag[h:]].mean() if flag[h:].any() else np.nan]
        print(f"{lab}: 켜짐 {n_on}주(독립 에피소드 {ep}개)")
        print(f"   12개월 수익 켜짐 {fwd[flag].mean():+.1%} vs 꺼짐 {fwd[~flag].mean():+.1%} → 차이 {d_ret:+.1%} "
              f"[90% {np.percentile(diff, 5):+.1%}, {np.percentile(diff, 95):+.1%}] · 단측 p(낮음) {p_lower:.4f}")
        print(f"   최대낙폭 켜짐 {mdd[flag].mean():+.1%} vs 꺼짐 {mdd[~flag].mean():+.1%} (차이 {d_mdd:+.1%}) · "
              f"반쪽별 수익 차이 {halves[0]:+.1%} / {halves[1]:+.1%}")
        res[lab] = dict(d=d_ret, p=p_lower, ep=ep, halves=halves)
    return res


def main():
    dk, Kk = load("kospi.json")
    ds, Ks = load("yh_GSPC_daily.json")
    rk = run("코스피", dk, Kk)
    rs = run("S&P500 (재현)", ds, Ks)
    a = rk.get("금리 상승(≥+1.0%p)")
    b = rs.get("금리 상승(≥+1.0%p)")
    print("\n===== 판정 =====")
    if not a or a["ep"] < 5:
        print("보류 (독립 에피소드 5개 미만 또는 표본 부족)"); return
    if a["d"] >= 0:
        v = "기각 (코스피 차이 ≥ 0)"
    elif a["p"] < 0.05 and all(x < 0 for x in a["halves"]) and b and b["d"] < 0:
        v = "성립"
    else:
        v = "미달 (일부만 충족)"
    print(f"코스피 차이 {a['d']:+.1%} · p {a['p']:.4f} · 반쪽 {a['halves'][0]:+.1%}/{a['halves'][1]:+.1%} · S&P 차이 "
          f"{(b['d'] if b else float('nan')):+.1%} → {v}")


if __name__ == "__main__":
    main()
