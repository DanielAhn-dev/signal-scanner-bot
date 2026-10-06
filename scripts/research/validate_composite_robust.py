# -*- coding: utf-8 -*-
"""C22 견고성 점검: 구성요소별·연도별·보유기간별·시장 상승/하락별·비용 후. 기준은 결과 보기 전 'C22 채택 시 연도 70% 이상에서 양수, 하락 구간에서도 평균 이상'으로 고정."""
import sys, os, collections
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import validate_composite_pref as cp
ef = cp.ef; lc, vt = ef.lc, ef.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
T, dates, Cf, O = ef.T, ef.dates, ef.Cf, ef.O
SPLIT = ef.SPLIT
rank01 = cp.rank01


def main():
    comps = {"저변동": lambda f: rank01(-f["20일 변동성"]), "52주 근접": lambda f: rank01(f["52주 고가 근접"]),
             "ROE": lambda f: rank01(f["ROE"]),
             "복합": lambda f: (rank01(-f["20일 변동성"]) + rank01(f["52주 고가 근접"]) + rank01(f["ROE"])) / 3,
             "저변동+52주": lambda f: (rank01(-f["20일 변동성"]) + rank01(f["52주 고가 근접"])) / 2}
    out = {(n, h): [] for n in comps for h in (20, 60)}   # (date, 상위20% 초과수익)
    absr = {h: [] for h in (20, 60)}                      # (date, 상위20% 절대, 전체 절대)
    costs = []
    for t in range(261, T - 62, 5):
        idx = np.where(lc.topm(t))[0]
        e = t + 1
        f = None
        for h in (20, 60):
            y = Cf[t + h + 1 if h == 60 else t + h, idx] / O[e, idx] - 1
            ok = np.isfinite(y)
            if ok.sum() < 100:
                continue
            ii, yy = idx[ok], y[ok]
            if f is None or h == 60:
                f = ef.features(t, ii)
            for n, fn in comps.items():
                s = fn(f); m = np.isfinite(s)
                if m.sum() < 80: continue
                top = m & (s >= np.nanpercentile(s, 80))
                out[(n, h)].append((dates[e], yy[top].mean() - yy[m].mean()))
                if n == "복합":
                    absr[h].append((dates[e], yy[top].mean(), yy.mean()))
                    if h == 20:
                        costs.append(np.mean([lc.rt_cost(j, t) for j in ii[top]]))
    def st(L):
        a = np.array([v for d, v in L if d < SPLIT]); b = np.array([v for d, v in L if d >= SPLIT])
        return a.mean(), vt.nw_t(a, 4 if len(L) else 4), b.mean(), vt.nw_t(b, 4)
    print("상위 20% 초과수익 (같은 날 평균 대비, 비용 전)")
    for (n, h), L in out.items():
        a, at, b, bt = st(L)
        print(f"  {n:<10}{h:>3}일: 안 {a*100:+.2f}% (t {at:.1f}) · 밖 {b*100:+.2f}% (t {bt:.1f})")
    print(f"\n왕복 비용(상위 20%): {np.nanmean(costs)*100:.2f}% → 20일 보유 순초과 안/밖: {(st(out[('복합',20)])[0]-np.nanmean(costs))*100:+.2f}% / {(st(out[('복합',20)])[2]-np.nanmean(costs))*100:+.2f}%")
    yr = collections.defaultdict(list)
    for d, v in out[("복합", 20)]: yr[d[:4]].append(v)
    pos = 0
    print("\n연도별 복합 20일 초과:")
    for y in sorted(yr):
        m = np.mean(yr[y]); pos += m > 0
        print(f"  {y}: {m*100:+.2f}% (n={len(yr[y])})")
    print(f"  양수 연도 {pos}/{len(yr)}")
    print("\n시장 상승/하락 구간(같은 기간 전체 평균 20일 수익 부호) — 상위20% 절대수익 vs 전체")
    A = np.array([(x[1], x[2]) for x in absr[20]])
    up = A[:, 1] > 0
    for nm, mk in (("전체 평균 +", up), ("전체 평균 −", ~up)):
        print(f"  {nm}: n={mk.sum()}  상위20% {A[mk,0].mean()*100:+.2f}%  전체 {A[mk,1].mean()*100:+.2f}%  차이 {(A[mk,0]-A[mk,1]).mean()*100:+.2f}%")
    big = A[:, 1] < -0.05
    print(f"  전체 평균 -5% 이하 구간 n={big.sum()}: 상위20% {A[big,0].mean()*100:+.2f}% 전체 {A[big,1].mean()*100:+.2f}%")

if __name__ == "__main__":
    main()
