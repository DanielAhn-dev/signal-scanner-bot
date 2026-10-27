# -*- coding: utf-8 -*-
"""
H70 (2026-10-27): '직전 20거래일 고점 대비 −5% 이하' 규칙이 이후 20거래일 −7% 낙폭을 변동성 기준선(B1)보다 잘 예측하는가.
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §13에 결과 보기 전 고정. 코스피 2013~는 증거로 쓰지 않는다.

실행: python scripts/research/forecast_rule_b2.py > .research-cache/forecast_rule_b2_out.txt
"""
import json
import sys
from datetime import date as _d

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
H, DROP, RULE = 20, -0.07, -0.05
BLOCK, NBOOT = 4, 10000
rng = np.random.default_rng(20261027)


def load(path, col=1):
    r = json.load(open(C + path, encoding="utf-8"))
    d = {x[0]: float(x[col]) for x in r}
    ds = sorted(d)
    return ds, np.array([d[x] for x in ds])


class Mkt:
    def __init__(self, dates, K):
        self.dates, self.K, self.T = dates, K, len(K)
        T = self.T
        ret = np.concatenate([[np.nan], np.diff(np.log(K))])
        rv = np.full(T, np.nan)
        for i in range(19, T):
            rv[i] = np.std(ret[i - 19:i + 1])
        self.vol = np.full(T, np.nan)
        for i in range(250, T):
            h = rv[i - 249:i + 1]
            h = h[np.isfinite(h)]
            if len(h) > 200 and np.isfinite(rv[i]):
                self.vol[i] = (h <= rv[i]).mean()
        self.dd = np.full(T, np.nan)
        for i in range(H, T):
            self.dd[i] = K[i] / K[i - H:i + 1].max() - 1
        self.y = np.full(T, np.nan)
        for i in range(T - H):
            self.y[i] = float(K[i + 1:i + H + 1].min() / K[i] - 1 <= DROP)
        wk = {}
        for i, dt in enumerate(dates):
            y, w, _ = _d(int(dt[:4]), int(dt[4:6]), int(dt[6:])).isocalendar()
            wk[(y, w)] = i
        self.weekly = sorted(wk.values())

    def rows(self, a, b):
        return np.array([i for i in self.weekly if a <= self.dates[i] < b
                         and np.isfinite(self.vol[i]) and np.isfinite(self.dd[i]) and np.isfinite(self.y[i])], int)

    def first_idx(self, d):
        return next((i for i, x in enumerate(self.dates) if x >= d), self.T)

    def predict(self, train, test):
        y = self.y[train]
        base = y.mean()
        p0 = np.full(len(test), base)
        edges = np.quantile(self.vol[train], [.2, .4, .6, .8])
        bt, bs = np.digitize(self.vol[train], edges), np.digitize(self.vol[test], edges)
        rate = np.array([(y[bt == b].sum() + base * 5) / ((bt == b).sum() + 5) for b in range(5)])
        p1 = rate[bs]
        ftr, fte = self.dd[train] <= RULE, self.dd[test] <= RULE
        r2 = {f: (y[ftr == f].sum() + base * 5) / ((ftr == f).sum() + 5) for f in (True, False)}
        p2 = np.array([r2[bool(f)] for f in fte])
        return p0, p1, p2

    def walk(self, tr0, te0):
        out = {k: [] for k in ("idx", "b0", "b1", "b2")}
        for yr in range(int(te0[:4]), int(self.dates[-1][:4]) + 1):
            t0, t1 = f"{yr}0101", f"{yr + 1}0101"
            cut = self.first_idx(t0)
            train = np.array([i for i in self.rows(tr0, t0) if i + H < cut], int)
            test = self.rows(t0, t1)
            if len(train) < 150 or len(test) == 0:
                continue
            p0, p1, p2 = self.predict(train, test)
            out["idx"] += list(test); out["b0"] += list(p0); out["b1"] += list(p1); out["b2"] += list(p2)
        return {k: np.array(v) for k, v in out.items()}

    def static(self, tr0, tr1, te0, te1):
        """학습 구간 전체로 한 번 학습해 다른 기간 평가. 결과 창이 학습 구간에 닿는 평가 표본은 제외."""
        train = self.rows(tr0, tr1)
        test = self.rows(te0, te1)
        first_train = train.min()
        test = np.array([i for i in test if i + H < first_train or i > train.max() + H], int)
        p0, p1, p2 = self.predict(train, test)
        return {"idx": test, "b0": p0, "b1": p1, "b2": p2}


def indep(ix, y):
    ev, last = 0, -999
    for i in ix[y == 1]:
        if i - last > H:
            ev += 1
        last = i
    return ev


def err(p, y): return (p - y) ** 2
def skill(a, b): return 1 - a.sum() / b.sum()


def boot(ea, eb):
    n = len(ea)
    nb = int(np.ceil(n / BLOCK))
    st = rng.integers(0, n - BLOCK + 1, size=(NBOOT, nb))
    ix = (st[:, :, None] + np.arange(BLOCK)).reshape(NBOOT, -1)[:, :n]
    s = 1 - ea[ix].sum(1) / eb[ix].sum(1)
    return np.percentile(s, [5, 95])


def main():
    dsp, Ksp = load("yh_GSPC_daily.json")
    dkq, Kkq = load("allweather/kr_index_KQ11.json", col=2)
    dkp, Kkp = load("kospi.json")
    dnd, Knd = load("yh_NDX_daily.json")
    markets = [
        ("S&P500 2003~", Mkt(dsp, Ksp), lambda m: m.walk("19910101", "20030101"), True),
        ("코스닥 2010~", Mkt(dkq, Kkq), lambda m: m.walk("20020101", "20100101"), True),
        ("코스피 초기 1998~2005", Mkt(dkp, Kkp), lambda m: m.static("20060101", "99999999", "19980101", "20060101"), True),
        ("나스닥100 2016~ (기술 전용)", Mkt(dnd, Knd), lambda m: m.walk("20110101", "20160101"), False),
    ]
    pooled = {"b0": [], "b1": [], "b2": [], "y": []}
    judged, results = [], []
    for name, m, run, is_judge in markets:
        r = run(m)
        ix = r["idx"]
        if len(ix) == 0:
            print(f"\n[{name}] 표본 없음"); continue
        y = m.y[ix]
        ev = indep(ix, y)
        on = m.dd[ix] <= RULE
        rate_on = y[on].mean() if on.any() else float("nan")
        rate_off = y[~on].mean()
        ratio = rate_on / rate_off if rate_off > 0 else float("nan")
        e0, e1, e2 = err(r["b0"], y), err(r["b1"], y), err(r["b2"], y)
        s1, s0 = skill(e2, e1), skill(e2, e0)
        lo, hi = boot(e2, e1)
        print(f"\n===== {name} ({m.dates[ix[0]]}~{m.dates[ix[-1]]}) =====")
        print(f"예측 {len(ix)}회 · −7% 발생 {int(y.sum())}회({y.mean():.1%}) · 독립 사건 {ev}건 · 규칙 켜짐 {on.sum()}회")
        print(f"발생률 켜짐 {rate_on:.1%} vs 꺼짐 {rate_off:.1%} (비 {ratio:.2f})")
        print(f"Brier B0 {e0.mean():.4f} · B1 {e1.mean():.4f} · B2 {e2.mean():.4f}")
        print(f"B2 스킬 vs B1 {s1:+.3f} [90% {lo:+.3f}, {hi:+.3f}] · vs B0 {s0:+.3f}")
        used = is_judge and ev >= 10
        if is_judge and not used:
            print("  → 독립 사건 10건 미만: 판정 제외(기술만)")
        if used:
            judged.append((name, s1, ratio))
            for k, e in (("b0", e0), ("b1", e1), ("b2", e2)):
                pooled[k] += list(e)
    print("\n===== 합산 판정 =====")
    if len(judged) < 2:
        print(f"판정 시장 {len(judged)}곳 → 보류"); return
    pe0, pe1, pe2 = (np.array(pooled[k]) for k in ("b0", "b1", "b2"))
    ps1, ps0 = skill(pe2, pe1), skill(pe2, pe0)
    lo, hi = boot(pe2, pe1)
    print(f"판정 시장 {len(judged)}곳: " + ", ".join(f"{n}(스킬 {s:+.3f}, 비 {r:.2f})" for n, s, r in judged))
    print(f"합산 스킬 vs B1 {ps1:+.3f} [90% {lo:+.3f}, {hi:+.3f}] · vs B0 {ps0:+.3f}")
    all_pos = all(s > 0 for _, s, _ in judged)
    ratios = all(r >= 1.5 for _, _, r in judged)
    nonpos = sum(1 for _, s, _ in judged if s <= 0)
    if all_pos and lo > 0 and ps0 > 0 and ratios:
        v = "통과"
    elif ps1 <= 0 or nonpos * 2 >= len(judged):
        v = "기각"
    else:
        v = "보류 (통과·기각 조건 모두 아님)"
    print(f"조건: 모든 시장 스킬>0 {all_pos} · 합산 하한>0 {lo > 0} · 합산 vs B0>0 {ps0 > 0} · 모든 시장 비≥1.5 {ratios}")
    print(f"판정: {v}")


if __name__ == "__main__":
    main()
