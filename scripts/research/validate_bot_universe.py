# -*- coding: utf-8 -*-
"""C26 봇 유니버스 근사에서 선호 점수·회피 규칙이 유지되는지. 기준은 hypothesis-ledger C26에 결과 보기 전 고정."""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import validate_composite_portfolio as cps
cp = cps.cp; ef = cps.ef; lc = ef.lc; vt = ef.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
T, N, codes, dates = vt.T, vt.N, vt.codes, vt.dates
cidx = {c: j for j, c in enumerate(codes)}
caps = json.load(open(".research-cache/stock_caps.json", encoding="utf-8"))
SH = np.full(N, np.nan)
for r in caps:
    j = cidx.get(r["code"])
    if j is not None and r.get("market_cap") and np.isfinite(vt.Cf[T - 1, j]) and vt.Cf[T - 1, j] > 0:
        SH[j] = float(r["market_cap"]) / vt.Cf[T - 1, j]
SURV = np.isfinite(SH)
print("시총 있는 종목", int(SURV.sum()), "/", N, flush=True)
CAP = vt.Cf * SH[None, :]
orig_topm = lc.topm
K = 233
_c = {}


def botm(t):
    if t not in _c:
        u = vt.UNIV[t] & np.isfinite(CAP[t - 1]) & (CAP[t - 1] >= 3e11) & (vt.TV20[t - 1] >= 5e9)
        v = np.where(u, CAP[t - 1], -np.inf)
        m = np.zeros(N, bool); m[np.argsort(-v)[:K]] = True
        _c[t] = u & m
    return _c[t]


_s = {}


def turn_surv(t):
    if t not in _s:
        _s[t] = orig_topm(t) & SURV
    return _s[t]


def st(L):
    a = np.array([v for d, v in L if d < ef.SPLIT]); b = np.array([v for d, v in L if d >= ef.SPLIT])
    return a.mean(), vt.nw_t(a, 4), b.mean(), vt.nw_t(b, 4)


def scan(label):
    pref, avoid_d, spread = [], [], []
    for t in range(261, T - 21, 5):
        idx = np.where(lc.topm(t))[0]
        e, x = t + 1, t + 20
        y = vt.Cf[x, idx] / vt.O[e, idx] - 1
        ok = np.isfinite(y)
        if ok.sum() < 60:
            continue
        idx, y = idx[ok], y[ok]
        f = ef.features(t, idx)
        s = (cp.rank01(-f["20일 변동성"]) + cp.rank01(f["52주 고가 근접"])) / 2
        m = np.isfinite(s)
        top = m & (s >= np.nanpercentile(s, 80))
        pref.append((dates[e], y[top].mean() - y[m].mean()))
        av = cp.avoid_mask(t, idx)
        if av.sum() >= 3 and (~av).sum() >= 20:
            avoid_d.append((dates[e], y[av].mean() - y[~av].mean()))
    print(f"\n[{label}] 평균 종목 수 {np.mean([lc.topm(t).sum() for t in range(300, T-21, 250)]):.0f}")
    a, at, b, bt = st(pref)
    print(f"  선호 점수 상위20%: 안 {a*100:+.2f}% (t {at:.1f}) · 밖 {b*100:+.2f}% (t {bt:.1f})")
    a, at, b, bt = st(avoid_d)
    print(f"  회피 3규칙 대상 − 나머지: 안 {a*100:+.2f}% (t {at:.1f}) · 밖 {b*100:+.2f}% (t {bt:.1f})  (n={len(avoid_d)})")


def main():
    for label, fn in (("거래대금 상위300 ∩ 생존", turn_surv), ("봇 유니버스 근사(시총 상위233)", botm)):
        lc.topm = fn
        scan(label)
        print("  포트폴리오(월 교체, 연수익/낙폭):")
        cps.report("   동일가중", cps.simulate("all", 0, 21))
        cps.report("   lv52 상위20", cps.simulate("lv52", 20, 21))
    lc.topm = orig_topm

if __name__ == "__main__":
    main()
