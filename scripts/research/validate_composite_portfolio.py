# -*- coding: utf-8 -*-
"""C23 포트폴리오 시뮬레이션. 월(21일)·분기(63일) 교체, 종가(t+1) 체결, 비용=수수료+매도세+슬리피지(회전율 기준)."""
import sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import validate_composite_pref as cp
ef = cp.ef; lc, vt = ef.lc, ef.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
T, N, dates, Cf = ef.T, vt.N, ef.dates, ef.Cf
EC = lc.EC
SPLIT = "20220101"
rank01 = cp.rank01
R = np.vstack([np.zeros((1, N)), Cf[1:] / Cf[:-1] - 1])
R = np.nan_to_num(R)


def side_cost(js, t, sell):
    sl = np.array([float(vt.slip(np.nan_to_num(vt.TV20[t - 1, j]))) for j in js])
    return vt.COMM + (vt.TAX if sell else 0) + sl


def pick(t, n, mode, avoid=False):
    idx = np.where(lc.topm(t))[0]
    if mode == "all":
        return idx, np.full(len(idx), 1 / len(idx))
    f = ef.features(t, idx)
    if mode == "comp":
        s = (rank01(-f["20일 변동성"]) + rank01(f["52주 고가 근접"]) + rank01(f["ROE"])) / 3
    elif mode == "lv52":
        s = (rank01(-f["20일 변동성"]) + rank01(f["52주 고가 근접"])) / 2
    elif mode == "lowvol":
        s = rank01(-f["20일 변동성"])
    ok = np.isfinite(s)
    if avoid:
        ok &= ~cp.avoid_mask(t, idx)
    ii, ss = idx[ok], s[ok]
    top = ii[np.argsort(-ss)[:n]]
    if len(top) == 0:
        return top, np.array([])
    return top, np.full(len(top), 1 / len(top))


def simulate(mode, n, step, avoid=False):
    nav = np.full(T, np.nan)
    v = 1.0
    w = {}  # j → 비중(금액 기준 value share)
    start = 261 + 250  # 재무·특징이 갖춰지는 2016년 초부터
    nav[start] = 1.0
    for t in range(start + 1, T):
        # 보유 수익 반영
        if w:
            js = np.array(list(w)); ws = np.array(list(w.values()))
            gr = ws * (1 + R[t, js])
            tot = gr.sum()
            cashw = 1 - ws.sum()
            v *= tot + cashw
            w = {j: g / (tot + cashw) for j, g in zip(js, gr)}
        if (t - start) % step == 1 or not w:
            if t + 1 >= T: nav[t] = v; continue
            top, tw = pick(t - 1, n, mode, avoid)   # t-1 신호, t 종가 체결
            if len(top) == 0:
                nav[t] = v; continue
            new = dict(zip(top, tw))
            cost = 0.0
            for j in set(w) | set(new):
                a, b = w.get(j, 0), new.get(j, 0)
                if b > a: cost += (b - a) * side_cost([j], t, False)[0]
                elif a > b: cost += (a - b) * side_cost([j], t, True)[0]
            v *= (1 - cost)
            w = new
        nav[t] = v
    return nav


def report(name, nav):
    out = []
    for lo, hi in (("20170101", "20211231"), ("20220101", "29991231"), ("20170101", "29991231")):
        ii = [i for i in range(511, T) if lo <= dates[i] <= hi and np.isfinite(nav[i])]
        a, b = ii[0], ii[-1]
        yrs = (b - a) / 252
        cagr = (nav[b] / nav[a]) ** (1 / yrs) - 1
        seg = nav[a:b + 1]; mdd = (seg / np.maximum.accumulate(seg) - 1).min()
        out.append(f"{cagr*100:+6.1f}%/{mdd*100:5.0f}%")
    print(f"{name:<26} 안 {out[0]} | 밖 {out[1]} | 전체 {out[2]}")


def main():
    print("(연수익/최대낙폭)  비용 반영, 종가 체결")
    ec = np.array([EC[i] / EC[511] for i in range(T)])
    report("KODEX200 보유(배당 제외)", ec)
    for step in (21, 63):
        print(f"--- {step}일마다 교체 ---")
        report("상위300 동일가중", simulate("all", 0, step))
        for n in (5, 10, 20):
            for mode in ("comp", "lv52"):
                report(f"{mode} 상위{n}", simulate(mode, n, step))
            report(f"comp 상위{n}+회피규칙", simulate("comp", n, step, True))

if __name__ == "__main__":
    main()
