# -*- coding: utf-8 -*-
"""
H72 (2026-10-27): 해설식 통념 8개가 코스피 20거래일 −7% 낙폭의 선행 신호인가.
정의·임계값·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §17에 결과 보기 전 고정.

실행: python scripts/research/validate_common_beliefs.py > .research-cache/common_beliefs_out.txt
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import forecast_rule_b2 as rb

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
H, BLOCK, NBOOT = 20, 4, 10000
START = "19980101"
rng = np.random.default_rng(20261027)

dates, K = rb.load("kospi.json")
m = rb.Mkt(dates, K)
T = m.T


def align(pairs, col=1, lag=1):
    d = {x[0]: float(x[col]) for x in pairs}
    out = np.full(T, np.nan)
    last = np.nan
    for i, dt in enumerate(dates):
        v = d.get(dt)
        if v is not None:
            last = v
        out[i] = last
    if lag:
        out = np.concatenate([np.full(lag, np.nan), out[:-lag]])
    return out


def chg(x, n, kind="pct"):
    out = np.full(T, np.nan)
    out[n:] = (x[n:] / x[:-n] - 1) if kind == "pct" else (x[n:] - x[:-n])
    return out


def monthly_curve():
    tn = json.load(open(C + "yh_TNX_me.json"))
    ir = json.load(open(C + "yh_IRX_me.json"))
    out = np.full(T, np.nan)
    for i, dt in enumerate(dates):
        y, mo = int(dt[:4]), int(dt[4:6]) - 1          # 전달 말 값은 이달부터 사용
        if mo == 0:
            y, mo = y - 1, 12
        k = f"{y}{mo:02d}"
        if k in tn and k in ir:
            out[i] = float(tn[k]) - float(ir[k])
    return out


KRW = align(json.load(open(C + "longrun/krw_usd_ecos.json")))
TNX = align(json.load(open(C + "yh_TNX_daily.json")))
GOLD = align(json.load(open(C + "allweather/us_GC_F.json")))
DBC = align(json.load(open(C + "allweather/us_DBC.json")), col=2)
VIX = align(json.load(open(C + "yh_VIX_daily.json")))
CURVE = monthly_curve()

CLAIMS = [
    ("1 달러 강세·원화 약세 (원/달러 20일 ≥ +3%)", chg(KRW, 20) >= 0.03, chg(KRW, 20)),
    ("2 금리 급등 (미 10년물 60일 ≥ +0.75%p)", chg(TNX, 60, "abs") >= 0.75, chg(TNX, 60, "abs")),
    ("3 금리 급락 (미 10년물 60일 ≤ −0.75%p)", chg(TNX, 60, "abs") <= -0.75, chg(TNX, 60, "abs")),
    ("4 장단기 역전 (10년물−3개월물 < 0)", CURVE < 0, CURVE),
    ("5 금값 급등 (금 60일 ≥ +10%)", chg(GOLD, 60) >= 0.10, chg(GOLD, 60)),
    ("6 원자재 급등 (DBC 60일 ≥ +15%)", chg(DBC, 60) >= 0.15, chg(DBC, 60)),
    ("7 원자재 급락 (DBC 60일 ≤ −15%)", chg(DBC, 60) <= -0.15, chg(DBC, 60)),
    ("8 공포지수 급등 (VIX 5일 ≥ +30%)", chg(VIX, 5) >= 0.30, chg(VIX, 5)),
]

FWD60 = np.full(T, np.nan)
FWD60[:-60] = K[60:] / K[:-60] - 1
BINS = np.digitize(m.vol, [.2, .4, .6, .8])


def stat(flag, y, b):
    num = den = 0.0
    for k in range(5):
        on, off = flag & (b == k), (~flag) & (b == k)
        if on.sum() and off.sum():
            num += on.sum() * (y[on].mean() - y[off].mean())
            den += on.sum()
    return num / den if den else np.nan


def boot_p(flag, y, b):
    n = len(y)
    nb = int(np.ceil(n / BLOCK))
    st = rng.integers(0, n - BLOCK + 1, size=(NBOOT, nb))
    ix = (st[:, :, None] + np.arange(BLOCK)).reshape(NBOOT, -1)[:, :n]
    F, Yv = flag[ix], y[ix]
    num = np.zeros(NBOOT); den = np.zeros(NBOOT)
    for k in range(5):
        bk = (b[ix] == k)
        on, off = F & bk, (~F) & bk
        non, noff = on.sum(1), off.sum(1)
        ok = (non > 0) & (noff > 0)
        ron = np.where(non > 0, (Yv * on).sum(1) / np.maximum(non, 1), 0)
        roff = np.where(noff > 0, (Yv * off).sum(1) / np.maximum(noff, 1), 0)
        num += np.where(ok, non * (ron - roff), 0)
        den += np.where(ok, non, 0)
    s = num / np.maximum(den, 1)
    return max(float((s <= 0).mean()), 1 / NBOOT), np.percentile(s, [5, 95])


def indep_on(ix, flag):
    ev, last = 0, -999
    for i in ix[flag]:
        if i - last > H:
            ev += 1
        last = i
    return ev


def compute():
    """통념별 결과를 계산해 돌려준다 (출력은 main, JSON 내보내기는 build_common_beliefs.py)."""
    results = []
    for name, sig, raw in CLAIMS:
        ok = np.isfinite(raw)
        cand = [i for i in m.weekly if dates[i] >= START and ok[i] and np.isfinite(m.y[i]) and np.isfinite(m.vol[i])]
        ix = np.array(cand)
        flag = sig[ix] & True
        y = m.y[ix]
        b = BINS[ix]
        n_on = int(flag.sum())
        ev = indep_on(ix, flag)
        r_on = y[flag].mean() if n_on else float("nan")
        r_off = y[~flag].mean()
        ratio = r_on / r_off if r_off > 0 else float("nan")
        s = stat(flag, y, b)
        p, ci = boot_p(flag, y, b) if n_on >= 5 else (1.0, (np.nan, np.nan))
        h = len(ix) // 2
        sh = [stat(flag[:h], y[:h], b[:h]), stat(flag[h:], y[h:], b[h:])]
        f60 = FWD60[ix]
        d60 = np.nanmean(f60[flag]) - np.nanmean(f60[~flag]) if n_on else float("nan")
        results.append(dict(name=name, n=len(ix), n_on=n_on, ev=ev, r_on=r_on, r_off=r_off, ratio=ratio,
                            s=s, p=p, ci=ci, sh=sh, d60=d60, first=dates[ix[0]], last=dates[ix[-1]]))
    # Holm 보정
    order = sorted(range(len(results)), key=lambda k: results[k]["p"])
    mtests, run = len(results), 0.0
    for rank, k in enumerate(order):
        run = max(run, min(1.0, (mtests - rank) * results[k]["p"]))
        results[k]["p_holm"] = run
    for r in results:
        if r["ev"] < 10:
            r["v"] = "보류"
        elif r["s"] <= 0 or r["p_holm"] >= 0.20:
            r["v"] = "기각"
        elif r["p_holm"] < 0.05 and all(x > 0 for x in r["sh"]) and r["ratio"] >= 1.3:
            r["v"] = "성립"
        else:
            r["v"] = "미달"
    return results


def main():
    results = compute()
    passed = sum(1 for r in results if r["v"] == "성립")
    print("H72 통념 검증 — 결과: 이후 20거래일 −7% 도달(T1), 변동성 5구간 통제 차이(켜짐 − 꺼짐), 4주 블록 부트스트랩 1만 회, Holm 보정(8개)\n")
    for r in results:
        label = {"보류": "판정 보류 (독립 사건 10건 미만)"}.get(r["v"], r["v"])
        print(f"[{r['name']}]  {r['first']}~{r['last']}  표본 {r['n']} · 켜짐 {r['n_on']}회(독립 {r['ev']}건)")
        print(f"   발생률 켜짐 {r['r_on']:.1%} vs 꺼짐 {r['r_off']:.1%} (비 {r['ratio']:.2f}) · 변동성 통제 차이 {r['s']:+.3f} "
              f"[90% {r['ci'][0]:+.3f}, {r['ci'][1]:+.3f}] · p {r['p']:.4f} → Holm {r['p_holm']:.4f}")
        print(f"   반쪽별 차이 {r['sh'][0]:+.3f} / {r['sh'][1]:+.3f} · 보조 60일 수익 차(켜짐−꺼짐) {r['d60']:+.2%}")
        print(f"   판정: {label}\n")
    print(f"성립 {passed}개 / {len(results)}개")


if __name__ == "__main__":
    main()
